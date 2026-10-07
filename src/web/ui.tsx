import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode
  variant?: string
  size?: string
}

/** Local button. Host primitive packages are not imported by a Web plugin. */
export function Button({ children, variant: _variant, size: _size, ...props }: ButtonProps) {
  return <button className="herdr-button" type="button" {...props}>{children}</button>
}

export function Pill({ children, tone, className }: { children?: ReactNode; tone?: string; className?: string }) {
  return <span className={'herdr-pill' + (tone ? ` is-${tone}` : '') + (className ? ` ${className}` : '')}>{children}</span>
}

export function StateDot({ status, state, className }: { status?: string; state?: string; className?: string }) {
  return <span className={'herdr-state-dot is-' + (state || status || 'unknown') + (className ? ` ${className}` : '')} aria-hidden="true" />
}
