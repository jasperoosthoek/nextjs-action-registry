import { describe, it, expect } from 'vitest';

import { supabaseAdapter, type SupabaseClientLike } from '../src/adapters/supabase';

type Result = { data: unknown; error: { message: string } | null };
type Call = { method: string; args: unknown[] };

function makeDb(results: { then?: Result; single?: Result; maybeSingle?: Result }) {
  const calls: Call[] = [];

  const builder = {
    select: (...args: unknown[]) => {
      calls.push({ method: 'select', args });
      return builder;
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: 'eq', args });
      return builder;
    },
    insert: (...args: unknown[]) => {
      calls.push({ method: 'insert', args });
      return builder;
    },
    update: (...args: unknown[]) => {
      calls.push({ method: 'update', args });
      return builder;
    },
    delete: (...args: unknown[]) => {
      calls.push({ method: 'delete', args });
      return builder;
    },
    single: () => {
      calls.push({ method: 'single', args: [] });
      return Promise.resolve(results.single ?? { data: null, error: null });
    },
    maybeSingle: () => {
      calls.push({ method: 'maybeSingle', args: [] });
      return Promise.resolve(results.maybeSingle ?? { data: null, error: null });
    },
    then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(results.then ?? { data: null, error: null }).then(resolve, reject),
  };

  const db = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
  } as unknown as SupabaseClientLike;

  return { db, calls };
}

describe('supabaseAdapter', () => {
  it('list selects all rows and applies scope', async () => {
    const rows = [{ id: 't1' }];
    const { db, calls } = makeDb({ then: { data: rows, error: null } });

    await expect(
      supabaseAdapter.list(db, 'tasks', { scope: { column: 'owner_id', value: 'u1' } }),
    ).resolves.toEqual(rows);

    expect(calls).toEqual([
      { method: 'from', args: ['tasks'] },
      { method: 'select', args: ['*'] },
      { method: 'eq', args: ['owner_id', 'u1'] },
    ]);
  });

  it('list returns [] for null data and throws on errors', async () => {
    const empty = makeDb({ then: { data: null, error: null } });
    await expect(supabaseAdapter.list(empty.db, 'tasks', { scope: null })).resolves.toEqual([]);

    const failing = makeDb({ then: { data: null, error: { message: 'list failed' } } });
    await expect(supabaseAdapter.list(failing.db, 'tasks', { scope: null })).rejects.toThrow(
      '[supabaseAdapter] list failed',
    );
  });

  it('get filters by id and scope, returning null for no row', async () => {
    const row = { id: 't1' };
    const { db, calls } = makeDb({ maybeSingle: { data: row, error: null } });

    await expect(
      supabaseAdapter.get(db, 'tasks', 'id', 't1', { scope: { column: 'owner_id', value: 'u1' } }),
    ).resolves.toEqual(row);

    expect(calls).toEqual([
      { method: 'from', args: ['tasks'] },
      { method: 'select', args: ['*'] },
      { method: 'eq', args: ['id', 't1'] },
      { method: 'eq', args: ['owner_id', 'u1'] },
      { method: 'maybeSingle', args: [] },
    ]);

    const missing = makeDb({ maybeSingle: { data: null, error: null } });
    await expect(
      supabaseAdapter.get(missing.db, 'tasks', 'id', 'missing', { scope: null }),
    ).resolves.toBeNull();
  });

  it('create injects ownership and overwrites caller ownership input', async () => {
    const created = { id: 't1', title: 'x', owner_id: 'u1' };
    const { db, calls } = makeDb({ single: { data: created, error: null } });

    await expect(
      supabaseAdapter.create(
        db,
        'tasks',
        'id',
        { title: 'x', owner_id: 'attacker' },
        { scope: { column: 'owner_id', value: 'u1' } },
      ),
    ).resolves.toEqual(created);

    expect(calls).toEqual([
      { method: 'from', args: ['tasks'] },
      { method: 'insert', args: [{ title: 'x', owner_id: 'u1' }] },
      { method: 'select', args: ['*'] },
      { method: 'single', args: [] },
    ]);
  });

  it('create leaves public rows unscoped', async () => {
    const created = { id: 'catalog1', label: 'x' };
    const { db, calls } = makeDb({ single: { data: created, error: null } });

    await expect(
      supabaseAdapter.create(db, 'catalog', 'id', { label: 'x' }, { scope: null }),
    ).resolves.toEqual(created);

    expect(calls[1]).toEqual({ method: 'insert', args: [{ label: 'x' }] });
  });

  it('update filters by id and scope, returning the updated row', async () => {
    const updated = { id: 't1', title: 'new' };
    const { db, calls } = makeDb({ single: { data: updated, error: null } });

    await expect(
      supabaseAdapter.update(
        db,
        'tasks',
        'id',
        't1',
        { title: 'new' },
        { scope: { column: 'owner_id', value: 'u1' } },
      ),
    ).resolves.toEqual(updated);

    expect(calls).toEqual([
      { method: 'from', args: ['tasks'] },
      { method: 'update', args: [{ title: 'new' }] },
      { method: 'eq', args: ['id', 't1'] },
      { method: 'eq', args: ['owner_id', 'u1'] },
      { method: 'select', args: ['*'] },
      { method: 'single', args: [] },
    ]);
  });

  it('remove filters by id and scope and verifies one deleted row', async () => {
    const { db, calls } = makeDb({ single: { data: { id: 't1' }, error: null } });

    await expect(
      supabaseAdapter.remove(db, 'tasks', 'id', 't1', { scope: { column: 'owner_id', value: 'u1' } }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      { method: 'from', args: ['tasks'] },
      { method: 'delete', args: [] },
      { method: 'eq', args: ['id', 't1'] },
      { method: 'eq', args: ['owner_id', 'u1'] },
      { method: 'select', args: ['id'] },
      { method: 'single', args: [] },
    ]);
  });

  it('remove throws when the delete verification returns an error', async () => {
    const { db } = makeDb({ single: { data: null, error: { message: '0 rows' } } });

    await expect(supabaseAdapter.remove(db, 'tasks', 'id', 't1', { scope: null })).rejects.toThrow(
      '[supabaseAdapter] 0 rows',
    );
  });
});

describe('supabaseAdapter — configurable idField', () => {
  it('get filters by the configured idField, not a hardcoded "id"', async () => {
    const row = { taskId: 't1' };
    const { db, calls } = makeDb({ maybeSingle: { data: row, error: null } });

    await expect(
      supabaseAdapter.get(db, 'tasks2', 'taskId', 't1', { scope: { column: 'owner_id', value: 'u1' } }),
    ).resolves.toEqual(row);

    expect(calls).toEqual([
      { method: 'from', args: ['tasks2'] },
      { method: 'select', args: ['*'] },
      { method: 'eq', args: ['taskId', 't1'] },
      { method: 'eq', args: ['owner_id', 'u1'] },
      { method: 'maybeSingle', args: [] },
    ]);
  });

  it('update filters by the configured idField, not a hardcoded "id"', async () => {
    const updated = { taskId: 't1', title: 'new' };
    const { db, calls } = makeDb({ single: { data: updated, error: null } });

    await expect(
      supabaseAdapter.update(db, 'tasks2', 'taskId', 't1', { title: 'new' }, { scope: null }),
    ).resolves.toEqual(updated);

    expect(calls).toEqual([
      { method: 'from', args: ['tasks2'] },
      { method: 'update', args: [{ title: 'new' }] },
      { method: 'eq', args: ['taskId', 't1'] },
      { method: 'select', args: ['*'] },
      { method: 'single', args: [] },
    ]);
  });

  it('remove filters AND verifies the delete using the configured idField (fixes the hardcoded "id" bug)', async () => {
    const { db, calls } = makeDb({ single: { data: { taskId: 't1' }, error: null } });

    await expect(
      supabaseAdapter.remove(db, 'tasks2', 'taskId', 't1', {
        scope: { column: 'owner_id', value: 'u1' },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      { method: 'from', args: ['tasks2'] },
      { method: 'delete', args: [] },
      { method: 'eq', args: ['taskId', 't1'] },
      { method: 'eq', args: ['owner_id', 'u1'] },
      { method: 'select', args: ['taskId'] },
      { method: 'single', args: [] },
    ]);
  });
});
