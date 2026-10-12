// Synchronous module-evaluation injection: DSH claimStyles owns this style on activation.
if (typeof document !== 'undefined' && !document.getElementById('herdr-environment-styles')) {
  const style = document.createElement('style')
  style.id = 'herdr-environment-styles'
  style.textContent = `
/* Environment management: native settings and dashboard share the same responsive surface. */
.herdr-setup { padding: 20px; margin: 12px; border: 1px solid var(--dsw-alias-border-main, #7775); border-radius: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); max-width: 960px; }
.herdr-setup-head, .herdr-setup-actions, .herdr-setup-command header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.herdr-setup h2, .herdr-setup h3, .herdr-setup h4 { margin: 0 0 8px; }
.herdr-setup h3 { margin-top: 24px; }
.herdr-setup p, .herdr-setup small, .herdr-setup-actions span { color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.herdr-setup-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 12px; }
.herdr-setup-facts > div { min-width: 0; }
.herdr-setup dt { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-bottom: 4px; }
.herdr-setup dd { margin: 0; overflow-wrap: anywhere; }
.herdr-setup-commands { display: grid; gap: 12px; }
.herdr-setup-command { border: 1px solid var(--dsw-alias-border-main, #7775); border-radius: 8px; padding: 12px; min-width: 0; }
.herdr-setup-command pre { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.6; }
.herdr-setup-warning { border-left: 3px solid var(--dsw-alias-state-warning, #b8860b); padding: 8px 12px; }
.herdr-setup-feedback { display: block; min-height: 1em; font-size: 12px; }
.herdr-setup a { color: var(--dsw-alias-state-business-primary); text-decoration: underline; }
.herdr-setup .herdr-button:focus-visible, .herdr-setup pre:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
@media (max-width: 600px) { .herdr-setup { margin: 8px; padding: 12px; } }

`
  document.head.appendChild(style)
}
export {}
