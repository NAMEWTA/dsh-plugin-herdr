// Web 面板 i18n（design: herdr-hero-branding §4.6 扩展）。
// 语言单一事实源：locale 服务 active（app.tsx 注入）→ setHerdrLang()；
// hero-branding.ts（data-herdr-lang / CSS content）与本模块共享该状态。
// 组件文案经 t(key) 或 useHerdrLang() 切换；新增用户可见文案必须同时补 zh + en。

import { useEffect, useState } from 'react'
import en from '../../locale/en.json' with { type: 'json' }
import zh from '../../locale/zh.json' with { type: 'json' }

export const HERDR_LOCALE_NS = 'herdr'

type LocaleDictionary = Record<string, string>
type LocaleRegistrar = {
  register(namespace: string, dictionaries: { zh: LocaleDictionary; en: LocaleDictionary }): () => void
}

/** Register panel copy. Plugin metadata stays in the same files under meta. */
export function registerHerdrLocale(locale: LocaleRegistrar): () => void {
  const entries = (file: Record<string, unknown>): LocaleDictionary => {
    const dictionary: LocaleDictionary = {}
    for (const [key, value] of Object.entries(file)) {
      if (key !== 'meta' && typeof value === 'string') dictionary[key] = value
    }
    return dictionary
  }
  return locale.register(HERDR_LOCALE_NS, { zh: entries(zh), en: entries(en) })
}

/** 界面语言（'zh' | 'en'；未知语言回退 zh）。 */
let herdrLang: 'zh' | 'en' = 'zh'

const listeners = new Set<() => void>()

/** 同步界面语言（app.tsx 订阅 locale 服务调用；hero-branding 的 setHerdrLang 亦转发至此）。 */
export function setHerdrLang(lang: string): void {
  const next = lang === 'en' ? 'en' : 'zh'
  if (next === herdrLang) return
  herdrLang = next
  for (const l of [...listeners]) l()
}

/** 同步读取当前语言（非 React 场景用）。 */
export function getHerdrLang(): 'zh' | 'en' {
  return herdrLang
}

/** 订阅语言变化（非 React 场景，如原生 DOM marker 按钮文案/aria 跟随）。 */
export function subscribeHerdrLang(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React hook：订阅语言变化（组件文案切换）。 */
export function useHerdrLang(): 'zh' | 'en' {
  const [lang, setLang] = useState<'zh' | 'en'>(herdrLang)
  useEffect(() => {
    const update = () => setLang(herdrLang)
    listeners.add(update)
    update()
    return () => {
      listeners.delete(update)
    }
  }, [])
  return lang
}

type LocaleTranslate = (key: string, params?: Record<string, string | number>) => string
let localeTranslate: LocaleTranslate | null = null

/** Point panel copy at ctx.locale.bind('herdr'). Null keeps the local fallback. */
export function setHerdrLocaleTranslate(next: LocaleTranslate | null): void {
  localeTranslate = next
}

type PanelDictionary = Omit<typeof zh, 'meta'>
export type I18nKey = keyof PanelDictionary

/**
 * 文案字典：key → { zh, en }。唯一来源是 locale/*.json（同一份也注册给 locale 服务）；
 * 这里只是派生视图，供无 locale 服务时回退与测试使用。
 */
export const I18N_KEYS = Object.fromEntries(
  (Object.keys(zh) as Array<keyof typeof zh>)
    .filter((key): key is I18nKey => key !== 'meta')
    .map(key => [key, { zh: zh[key], en: (en as unknown as PanelDictionary)[key] }]),
) as Record<I18nKey, { zh: string; en: string }>

/** 取当前语言文案（模板参数 {x} 用 params 替换；缺失 key 回退 zh，再缺失返回 key 本身）。 */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  if (localeTranslate) {
    const translated = localeTranslate(key, params)
    if (translated !== key) return translated
  }
  const entry = I18N_KEYS[key]
  if (entry === undefined) return key
  const text = entry[herdrLang] ?? entry.zh
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}
