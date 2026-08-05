import type { Adapter, ScopeFilter } from '../../src';

// A scope-honoring in-memory adapter for tests — enforces ownership the way a real datasource
// (Supabase + RLS / the supabaseAdapter) does, so tenant isolation can be tested without a DB.
type Row = Record<string, unknown> & { id: string };

const matches = (row: Row, scope: ScopeFilter): boolean =>
  scope === null || row[scope.column] === scope.value;

export function createMemAdapter(): { adapter: Adapter<null>; reset: () => void } {
  const tables: Record<string, Row[]> = {};
  let seq = 1;
  const rowsOf = (name: string): Row[] => (tables[name] ??= []);

  const adapter: Adapter<null> = {
    list: async (_db, table, { scope }) => rowsOf(table).filter((r) => matches(r, scope)),

    get: async (_db, table, id, { scope }) =>
      rowsOf(table).find((r) => r.id === id && matches(r, scope)) ?? null,

    create: async (_db, table, values, { scope }) => {
      const row: Row = { ...values, id: String(seq++), ...(scope ? { [scope.column]: scope.value } : {}) };
      rowsOf(table).push(row);
      return row;
    },

    update: async (_db, table, id, patch, { scope }) => {
      const row = rowsOf(table).find((r) => r.id === id && matches(r, scope));
      if (!row) throw new Error(`${table} ${id} not found`); // cross-owner / missing → reject
      Object.assign(row, patch);
      return row;
    },

    remove: async (_db, table, id, { scope }) => {
      const rows = rowsOf(table);
      const i = rows.findIndex((r) => r.id === id && matches(r, scope));
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
  };
}
