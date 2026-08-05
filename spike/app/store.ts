import type { Adapter, ScopeFilter } from '../../src/index';

// A tiny in-memory adapter (module-level, so it persists across requests in the dev server).
// Enough to see create/list/remove actually work end-to-end.
type Row = Record<string, unknown> & { id: string };

const tables: Record<string, Row[]> = {};
const tableRows = (name: string): Row[] => (tables[name] ??= []);
let seq = 1;

const matches = (row: Row, scope: ScopeFilter): boolean =>
  scope === null || row[scope.column] === scope.value;

export const memAdapter: Adapter<null> = {
  list: async (_db, table, { scope }) => tableRows(table).filter((r) => matches(r, scope)),

  get: async (_db, table, id, { scope }) =>
    tableRows(table).find((r) => r.id === id && matches(r, scope)) ?? null,

  create: async (_db, table, values, { scope }) => {
    // Ownership injection: the owner column comes from `scope`, never the caller.
    const row: Row = { ...values, id: String(seq++), ...(scope ? { [scope.column]: scope.value } : {}) };
    tableRows(table).push(row);
    return row;
  },

  update: async (_db, table, id, patch, { scope }) => {
    const row = tableRows(table).find((r) => r.id === id && matches(r, scope));
    if (!row) throw new Error(`${table} ${id} not found`);
    Object.assign(row, patch);
    return row;
  },

  remove: async (_db, table, id, { scope }) => {
    const rows = tableRows(table);
    const i = rows.findIndex((r) => r.id === id && matches(r, scope));
    if (i >= 0) rows.splice(i, 1);
  },
};
