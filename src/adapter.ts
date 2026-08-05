/** Datasource adapter contract. Consumed from v0.0.2 by `defineResource`. */

/**
 * Ownership scope. For read/update/remove it is a WHERE filter; for create the
 * adapter INJECTS it, overwriting caller input (no ownership spoofing).
 * `null` means the resource is not owner-scoped.
 */
export type ScopeFilter = { column: string; value: string } | null;

/**
 * Abstracts ONLY the closed set of operations `defineResource` generates. Bespoke
 * `action()` handlers bypass the adapter entirely and use `ctx.db` raw.
 *
 * `values`/`patch` reaching the adapter are ALREADY narrowed + validated by the
 * writable-field contract — the adapter never sees raw client payloads.
 */
export type Adapter<DB> = {
  list: (db: DB, table: string, opts: { scope: ScopeFilter }) => Promise<unknown[]>;
  get: (db: DB, table: string, id: string, opts: { scope: ScopeFilter }) => Promise<unknown | null>;
  create: (
    db: DB,
    table: string,
    values: Record<string, unknown>,
    opts: { scope: ScopeFilter },
  ) => Promise<unknown>;
  update: (
    db: DB,
    table: string,
    id: string,
    patch: Record<string, unknown>,
    opts: { scope: ScopeFilter },
  ) => Promise<unknown>;
  remove: (db: DB, table: string, id: string, opts: { scope: ScopeFilter }) => Promise<void>;
};
