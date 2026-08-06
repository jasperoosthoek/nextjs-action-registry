import type { Adapter, ScopeFilter } from '@jasperoosthoek/nextjs-action-registry';

// Module-level, so state persists across requests in the dev server.
type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};
const tableRows = (name: string): Row[] => (tables[name] ??= []);
let seq = 1;

const matches = (row: Row, scope: ScopeFilter): boolean =>
  scope === null || row[scope.column] === scope.value;

export const memAdapter: Adapter<null> = {
  list: async (_db, table, { scope }) => tableRows(table).filter((r) => matches(r, scope)),

  get: async (_db, table, idField, id, { scope }) =>
    tableRows(table).find((r) => r[idField] === id && matches(r, scope)) ?? null,

  create: async (_db, table, idField, values, { scope }) => {
    // Ownership injection: the owner column comes from `scope`, never the caller.
    const row: Row = {
      ...values,
      [idField]: String(seq++),
      ...(scope ? { [scope.column]: scope.value } : {}),
    };
    tableRows(table).push(row);
    return row;
  },

  update: async (_db, table, idField, id, patch, { scope }) => {
    const row = tableRows(table).find((r) => r[idField] === id && matches(r, scope));
    if (!row) throw new Error(`${table} ${id} not found`);
    Object.assign(row, patch);
    return row;
  },

  remove: async (_db, table, idField, id, { scope }) => {
    const rows = tableRows(table);
    const i = rows.findIndex((r) => r[idField] === id && matches(r, scope));
    if (i < 0) throw new Error(`${table} ${id} not found`);
    rows.splice(i, 1);
  },
};

// Validates that `listId` belongs to `userId` — the in-memory equivalent of a real app's ownedVia
// resolver querying the parent table. Throws on a missing or foreign list (the security linchpin
// for parent-scoped `items`; wired into the registry's `scopes.list`).
export function assertOwnsList(userId: string, listId: string): string {
  const list = tableRows('lists').find((r) => r.id === listId);
  if (!list || list.owner_id !== userId) throw new Error('List not found');
  return listId;
}

// Looks up a demo user's first seeded list — builds the "open another user's list" link without
// hardcoding a row id (which would drift as the shared `seq` counter above changes).
export function firstListIdFor(userId: string): string | undefined {
  const list = tableRows('lists').find((r) => r.owner_id === userId);
  return typeof list?.id === 'string' ? list.id : undefined;
}

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

  const list = (owner_id: string, name: string) => ({ id: String(seq++), name, owner_id });
  const aliceGroceries = list('alice', 'Groceries');
  const aliceTrip = list('alice', 'Weekend trip');
  const bobRenovation = list('bob', 'Home renovation');
  tableRows('lists').push(aliceGroceries, aliceTrip, bobRenovation);

  const item = (list_id: string, title: string, done = false) => ({ id: String(seq++), title, done, list_id });
  tableRows('items').push(
    item(aliceGroceries.id, 'Milk'),
    item(aliceGroceries.id, 'Eggs', true),
    item(aliceTrip.id, 'Book flights'),
    item(bobRenovation.id, 'Paint the fence'),
  );
}
seed();
