import type { Adapter, ScopeFilter } from '@jasperoosthoek/nextjs-action-registry';

// Module-level, so state persists across requests in the dev server.
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
    if (i < 0) throw new Error(`${table} ${id} not found`);
    rows.splice(i, 1);
  },
};

// Filters to `userId`'s own rows before swapping, so a caller can't reorder another tenant's tasks.
export function moveTask(userId: string, id: string, direction: 'up' | 'down'): void {
  const rows = tableRows('tasks');
  const own = rows.filter((r) => r.owner_id === userId);
  const i = own.findIndex((r) => r.id === id);
  if (i < 0) return;
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= own.length) return;
  const a = rows.indexOf(own[i]);
  const b = rows.indexOf(own[j]);
  [rows[a], rows[b]] = [rows[b], rows[a]];
}

// Seed both demo tenants so switching users in the nav shows visibly different data.
function seed(): void {
  if (tableRows('tasks').length > 0) return;
  const task = (owner_id: string, title: string, done = false) => ({
    id: String(seq++),
    title,
    done,
    owner_id,
  });
  tableRows('tasks').push(
    task('alice', 'Write the quarterly report'),
    task('alice', 'Review PR #482', true),
    task('bob', 'Plan sprint kickoff'),
  );
  const note = (owner_id: string, title: string, body: string) => ({
    id: String(seq++),
    title,
    body,
    owner_id,
  });
  tableRows('notes').push(
    note('alice', 'Standup notes', 'Ship the CSV export by Friday.'),
    note('bob', 'Ideas', 'Try a caching layer for the dashboard.'),
  );
}
seed();
