const natural = new Intl.Collator('en', { numeric: true })
export function comparePaneId(a: string, b: string): number { return natural.compare(a, b) }
export function compareWorkspaceId(a: string, b: string): number { return natural.compare(a, b) }
