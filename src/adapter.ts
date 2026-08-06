/** Datasource adapter contract. Consumed by `defineResource`; `supabaseAdapter` is the reference impl. */

/**
 * Ownership scope for one operation.
 * - For **read / update / remove** it is a WHERE filter (`column === value`).
 * - For **create** the adapter INJECTS it, overwriting any caller value (no ownership spoofing).
 * - `null` means the resource opted out of ownership scoping (`scope: 'public'`, reads only).
 *
 * `value` is always the authenticated `ctx.userId`; `column` is the resource's ownership column.
 */
export type ScopeFilter = { column: string; value: string } | null;

/**
 * Abstracts ONLY the closed set of operations `defineResource` generates (keyed by a single PK
 * column — `idField`, `'id'` by default). Bespoke `action()` handlers bypass the adapter entirely
 * and use `ctx.db` raw.
 *
 * **Security contract for adapter authors (the type system cannot enforce these — you must, and
 * the `@…/testing` tenant-isolation harness is how you verify them against a real DB):**
 *
 * - `list` / `get` — MUST apply `scope` as a filter. A `get` for a row owned by another tenant
 *   MUST return `null`; a `list` MUST omit other tenants' rows. Never return unscoped data.
 * - `create` — MUST set the ownership column from `scope` (`values[scope.column] = scope.value`),
 *   **overwriting** any caller-supplied value, so ownership cannot be spoofed. `values` is already
 *   narrowed to the writable allowlist (no `idField`, no ownership/readonly fields, no mass
 *   assignment). A DB-assigning adapter may ignore `idField` here; a self-assigning one must set
 *   the new row's id under it.
 * - `update` — MUST apply `scope` AND affect exactly the one matching row; a 0-row match (row
 *   owned by another tenant, or missing) MUST **reject** (throw), not silently succeed.
 * - `remove` — same as `update`: scope-filtered, and a 0-row delete MUST **reject**, so a
 *   cross-owner delete can't look successful (and trigger revalidation).
 *
 * The library assumes a user-scoped `db` client (its own row security, e.g. Postgres RLS, is a
 * second layer). With a service-role/admin client these adapter-level checks are the ONLY
 * boundary — so they are not optional.
 */
export type Adapter<DB> = {
  list: (db: DB, table: string, opts: { scope: ScopeFilter }) => Promise<unknown[]>;
  /** `idField` is the resolved PK column (`'id'` unless the resource configures `idField`). */
  get: (
    db: DB,
    table: string,
    idField: string,
    id: string,
    opts: { scope: ScopeFilter },
  ) => Promise<unknown | null>;
  /**
   * A DB that auto-assigns the PK (e.g. Postgres) may ignore `idField`; an adapter that
   * self-assigns an id (e.g. an in-memory store) must assign it under this column.
   */
  create: (
    db: DB,
    table: string,
    idField: string,
    values: Record<string, unknown>,
    opts: { scope: ScopeFilter },
  ) => Promise<unknown>;
  update: (
    db: DB,
    table: string,
    idField: string,
    id: string,
    patch: Record<string, unknown>,
    opts: { scope: ScopeFilter },
  ) => Promise<unknown>;
  remove: (
    db: DB,
    table: string,
    idField: string,
    id: string,
    opts: { scope: ScopeFilter },
  ) => Promise<void>;
};
