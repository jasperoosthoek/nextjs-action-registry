import type { Adapter, ScopeFilter } from '../../src';

// A scope-honoring in-memory adapter for tests — enforces ownership the way a real datasource
// (Supabase + RLS / the supabaseAdapter) does, so tenant isolation can be tested without a DB.
type Row = Record<string, unknown>;

const matches = (row: Row, scope: ScopeFilter): boolean =>
  scope === null || row[scope.column] === scope.value;

export function createMemAdapter(): {
  adapter: Adapter<null>;
  reset: () => void;
  /** Read a table's rows directly — lets a test build a realistic ownedVia resolver (querying the
   * parent table, the way a real app's resolver queries its DB) instead of hardcoding pass/fail. */
  rows: (table: string) => Row[];
} {
  const tables: Record<string, Row[]> = {};
  let seq = 1;
  const rowsOf = (name: string): Row[] => (tables[name] ??= []);

  const adapter: Adapter<null> = {
    list: async (_db, table, { scope }) => rowsOf(table).filter((r) => matches(r, scope)),

    get: async (_db, table, idField, id, { scope }) =>
      rowsOf(table).find((r) => r[idField] === id && matches(r, scope)) ?? null,

    create: async (_db, table, idField, values, { scope }) => {
      const row: Row = {
        ...values,
        [idField]: String(seq++),
        ...(scope ? { [scope.column]: scope.value } : {}),
      };
      rowsOf(table).push(row);
      return row;
    },

    update: async (_db, table, idField, id, patch, { scope }) => {
      const row = rowsOf(table).find((r) => r[idField] === id && matches(r, scope));
      if (!row) throw new Error(`${table} ${id} not found`); // cross-owner / missing → reject
      Object.assign(row, patch);
      return row;
    },

    remove: async (_db, table, idField, id, { scope }) => {
      const rows = rowsOf(table);
      const i = rows.findIndex((r) => r[idField] === id && matches(r, scope));
      if (i < 0) throw new Error(`${table} ${id} not found`); // 0-row delete → reject
      rows.splice(i, 1);
    },
  };

  return {
    adapter,
    reset: () => {
      for (const k of Object.keys(tables)) delete tables[k];
      seq = 1;
    },
    rows: rowsOf,
  };
}
