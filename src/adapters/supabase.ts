import type { Adapter } from '../adapter';

/**
 * `supabaseAdapter` — the shipped default datasource adapter.
 *
 * Typed against a minimal structural view of the supabase-js client (the five ops it needs), so
 * the library carries no `@supabase/supabase-js` dependency. A real `SupabaseClient` satisfies
 * this shape. End-to-end correctness against a live DB is covered by the tenant-isolation tests.
 */

type PgError = { message: string } | null;

interface PgBuilder extends PromiseLike<{ data: unknown[] | null; error: PgError }> {
  select(columns?: string): PgBuilder;
  eq(column: string, value: unknown): PgBuilder;
  single(): PromiseLike<{ data: unknown; error: PgError }>;
  maybeSingle(): PromiseLike<{ data: unknown; error: PgError }>;
}

interface PgTable {
  select(columns?: string): PgBuilder;
  insert(values: unknown): PgBuilder;
  update(patch: unknown): PgBuilder;
  delete(): PgBuilder;
}

export interface SupabaseClientLike {
  from(table: string): PgTable;
}

function unwrap<R>(res: { data: R; error: PgError }): R {
  if (res.error) throw new Error(`[supabaseAdapter] ${res.error.message}`);
  return res.data;
}

export const supabaseAdapter: Adapter<SupabaseClientLike> = {
  async list(db, table, { scope }) {
    let q = db.from(table).select('*');
    if (scope) q = q.eq(scope.column, scope.value);
    return unwrap(await q) ?? [];
  },

  async get(db, table, idField, id, { scope }) {
    let q = db.from(table).select('*').eq(idField, id);
    if (scope) q = q.eq(scope.column, scope.value);
    return unwrap(await q.maybeSingle()) ?? null;
  },

  async create(db, table, _idField, values, { scope }) {
    // idField unused: Postgres auto-assigns the PK regardless of its column name.
    // Ownership injection: overwrite the owner column from `scope` — caller input can't spoof it.
    const row = scope ? { ...values, [scope.column]: scope.value } : values;
    return unwrap(await db.from(table).insert(row).select('*').single());
  },

  async update(db, table, idField, id, patch, { scope }) {
    let q = db.from(table).update(patch).eq(idField, id);
    if (scope) q = q.eq(scope.column, scope.value);
    return unwrap(await q.select('*').single());
  },

  async remove(db, table, idField, id, { scope }) {
    let q = db.from(table).delete().eq(idField, id);
    if (scope) q = q.eq(scope.column, scope.value);
    // `.select().single()` verifies EXACTLY ONE row was deleted. PostgREST does not error on a
    // 0-row delete, so a cross-owner delete (row exists, owner filter matches nothing) would
    // otherwise "succeed" and trigger revalidation. `.single()` turns 0 rows into an error.
    // MUST select the actual PK column (idField), not a hardcoded 'id' — a table whose PK isn't
    // literally named 'id' would otherwise error selecting a column that doesn't exist.
    const { error } = await q.select(idField).single();
    if (error) throw new Error(`[supabaseAdapter] ${error.message}`);
  },
};
