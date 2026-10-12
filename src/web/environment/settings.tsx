import { useCallback, useEffect, useRef, useState } from 'react'
import { environmentCommands, HERDR_INSTALL_DOCS, NODE_INSTALL_DOCS, type HerdrEnvironmentReport } from '../../core/environment.ts'
import { getHerdrRemote } from '../remote.ts'
import { Button } from '../ui.tsx'
import { t, useHerdrLang } from '../i18n.ts'
import { statusStore } from '../store.ts'
import { checkEnvironment, setupFailureDetail } from './check.ts'

export interface EnvironmentViewProps {
  report: HerdrEnvironmentReport | null
  busy: boolean
  error: string | null
  copied?: string | null
  onCheck: () => void
  onStart: () => void
  onCopy: (id: string, command: string) => void
}

/** Shared by the dashboard and the native settings.plugins.tab surface. */
export function EnvironmentView({ report, busy, error, copied, onCheck, onStart, onCopy }: EnvironmentViewProps) {
  void useHerdrLang()
  const commands = report ? environmentCommands(report.host) : []
  const canStart = report?.supported && report.cli.state === 'available' && !report.connection.running
  const unknown = t('setup.unknown')
  const connection = report?.connection
  const warning = report && (report.cli.version && report.cli.version !== report.verified.version || connection?.running && connection.version !== report.verified.version)
  const mismatch = report && connection?.running && connection.protocol !== report.verified.protocol
  return (
    <section className="herdr-setup" aria-label={t('setup.title')} aria-busy={busy}>
      <header className="herdr-setup-head">
        <div><h2>{t('setup.title')}</h2><p>{t('setup.hostNotice')}</p></div>
        <Button disabled={busy} onClick={onCheck}>{busy ? t('setup.checking') : t('setup.check')}</Button>
      </header>
      {error ? <p className="herdr-setup-warning" role="alert">{error}</p> : null}
      {!report ? <p role="status">{busy ? t('setup.checking') : t('setup.noReport')}</p> : (
        <>
          <dl className="herdr-setup-facts">
            <div><dt>{t('setup.host')}</dt><dd>{report.host.hostname} · {report.host.platform} / {report.host.arch}{report.host.wsl ? t('setup.wslHost') : ''}</dd></div>
            <div><dt>{t('setup.runtime')}</dt><dd>{report.host.nodeVersion}</dd></div>
            <div><dt>{t('setup.cli')}</dt><dd data-cli-state={report.cli.state}>{t(`setup.cli.${report.cli.state}`)}{report.cli.version ? ` · ${report.cli.version}` : ''}</dd></div>
            <div><dt>{t('setup.npm')}</dt><dd>{report.packageManagers.npm ? t('setup.found') : t('setup.missing')}</dd></div>
            <div><dt>{t('setup.pnpm')}</dt><dd>{report.packageManagers.pnpm ? t('setup.found') : t('setup.missing')}</dd></div>
            <div><dt>{t('setup.connection')}</dt><dd data-connection={connection!.running ? 'connected' : 'disconnected'}>{connection!.running ? t('setup.connected', { version: connection!.version ?? unknown, protocol: connection!.protocol ?? unknown }) : t('setup.disconnected')}</dd></div>
            <div><dt>{t('setup.terminal')}</dt><dd>{!report.terminal.enabled ? t('setup.disabled') : report.terminal.available ? t('setup.found') : t('setup.unavailable')}</dd></div>
          </dl>
          {!report.supported ? <p className="herdr-setup-warning" role="alert">{report.host.platform === 'win32' ? t('setup.windows') : t('setup.unsupported')}</p> : null}
          {mismatch ? <p className="herdr-setup-warning" role="alert">{t('setup.protocolMismatch', { expected: report.verified.protocol })}</p> : null}
          <p className={warning ? 'herdr-setup-warning' : undefined}>{t('setup.versionWarning', { version: report.verified.version })}</p>
          <div className="herdr-setup-actions">
            <Button disabled={busy || !canStart} onClick={onStart}>{t('setup.start')}</Button>
            <span>{t('setup.noStop')}</span>
          </div>
          <h3>{t('setup.install')}</h3>
          <p>{t('setup.noNpmHerdr')}</p>
          <p>{t('setup.manualInstall')}</p>
          {!report.packageManagers.npm && report.supported ? <p className="herdr-setup-warning">{t('setup.npmMissing')} <a href={NODE_INSTALL_DOCS} target="_blank" rel="noreferrer">{t('setup.nodeDocs')}</a></p> : null}
          <div className="herdr-setup-commands">
            {commands.map(({ id, command }) => (
              <article key={id} className="herdr-setup-command" data-command={id}>
                <header><h4>{t(`setup.command.${id}`)}</h4><Button onClick={() => onCopy(id, command)} aria-label={t('setup.copyNamed', { name: t(`setup.command.${id}`) })}>{copied === id ? t('setup.copied') : t('setup.copy')}</Button></header>
                <pre tabIndex={0}><code>{command}</code></pre>
                {id === 'dsh' ? <p>{t('setup.dshWarning')}</p> : null}
              </article>
            ))}
          </div>
          <p><a href={HERDR_INSTALL_DOCS} target="_blank" rel="noreferrer">{t('setup.officialDocs')}</a></p>
          <h3>{t('setup.configuration')}</h3>
          <p>{t('setup.configNotice')}</p>
          <dl className="herdr-setup-facts">
            <div><dt>{t('setup.binaryPath')}</dt><dd><code>{report.cli.path ?? t('setup.notFound')}</code></dd></div>
            <div><dt>{t('setup.socketPath')}</dt><dd><code>{connection!.socketPath ?? unknown}</code></dd></div>
            <div><dt>{t('setup.session')}</dt><dd>{connection!.session || t('setup.defaultSession')}</dd></div>
          </dl>
          <p>{t('setup.pathHelp')}</p>
          <small>{t('setup.checkedAt', { time: new Date(report.checkedAt).toLocaleTimeString() })}</small>
        </>
      )}
      <span className="herdr-setup-feedback" role="status" aria-live="polite">{copied ? t('setup.copied') : ''}</span>
    </section>
  )
}

export function HerdrEnvironmentSettings() {
  const [report, setReport] = useState<HerdrEnvironmentReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const alive = useRef(false)
  const revision = useRef(0)
  const check = useCallback(async (start = false) => {
    const current = ++revision.current
    setBusy(true)
    setError(null)
    try {
      const next = await checkEnvironment(getHerdrRemote(), start)
      if (alive.current && current === revision.current) {
        setReport(next)
        statusStore.refresh()
      }
    } catch (cause) {
      if (alive.current && current === revision.current) {
        const summary = t(start ? 'setup.startFailed' : 'setup.checkFailed')
        const detail = setupFailureDetail(cause)
        setError(detail ? `${summary} ${detail}` : summary)
      }
    } finally {
      if (alive.current && current === revision.current) setBusy(false)
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void check()
    return () => { alive.current = false; revision.current++ }
  }, [check])
  const copy = async (id: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command)
      if (alive.current) { setCopied(id); setError(null) }
    } catch {
      if (alive.current) setError(t('setup.copyFailed'))
    }
  }
  return <EnvironmentView report={report} busy={busy} error={error} copied={copied}
    onCheck={() => { void check() }} onStart={() => { void check(true) }} onCopy={(id, command) => { void copy(id, command) }} />
}
