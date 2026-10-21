import type { Json, AuditRecord } from '@workbench/contracts'
import type { AuditSink, ScopedStorage, StorageDriver, Stored } from '@workbench/sdk'
import { WorkbenchError } from './errors.ts'
const valid = (key: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(key)
export function assertStorageKey(key: string): void {
  if (!valid(key) || key === '__proto__' || key === 'constructor') throw new WorkbenchError('INVALID_REQUEST', 'Invalid storage key')
}
export class MemoryStorage implements StorageDriver {
  private readonly values = new Map<string, Stored<Json>>()
  scope(namespace: string): ScopedStorage {
    assertStorageKey(namespace)
    return {
      read: async <T extends Json>(key: string) => {
        assertStorageKey(key)
        return structuredClone(this.values.get(namespace + ':' + key) ?? null) as Stored<T> | null
      },
      write: async <T extends Json>(key: string, value: T, expectedVersion: number | null): Promise<Stored<T>> => {
        assertStorageKey(key)
        const fullKey = namespace + ':' + key
        const old = this.values.get(fullKey)
        if ((old?.version ?? null) !== expectedVersion) throw new WorkbenchError('RESOURCE_CHANGED')
        const next = { version: (old?.version ?? 0) + 1, value: structuredClone(value) }
        this.values.set(fullKey, next)
        return structuredClone(next)
      },
    }
  }
}
export class MemoryAudit implements AuditSink {
  private records: AuditRecord[] = []
  constructor(private readonly capacity = 1000) {}
  async append(record: AuditRecord): Promise<void> {
    this.records.push(structuredClone(record))
    this.records = this.records.slice(-this.capacity)
  }
  async read(limit: number): Promise<readonly AuditRecord[]> {
    const count = Math.min(200, Math.max(0, Math.trunc(limit)))
    return count > 0 ? structuredClone(this.records.slice(-count).reverse()) : []
  }
}
