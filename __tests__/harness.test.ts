import { describe, it, expect, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { createActionRegistry } from '../src';
import type { Adapter } from '../src';
import { checkTenantIsolation } from '../src/testing';
import { createMemAdapter } from './support/memAdapter';

type Task = { id: string; title: string; done: boolean; owner_id: string };

// Build the tasks resource for a given user (or an unauthenticated context that throws).
function resourceFor(userId: string | null, adapter: Adapter<null>) {
  const { defineResource } = createActionRegistry({
    createContext: async () => {
      if (userId === null) throw new Error('Unauthenticated');
      return { db: null, userId };
    },
    adapter,
  });
  return defineResource<Task>()({
    table: 'tasks',
    scope: { column: 'owner_id' },
    writableFields: ['title', 'done'],
    actions: { list: true, get: true, create: true, update: true, remove: true },
  });
}

describe('tenant-isolation harness (example-app contract test)', () => {
  it('reports no failures for a correctly-scoped resource', async () => {
    const { adapter } = createMemAdapter();
    const asA = resourceFor('userA', adapter);
    const asB = resourceFor('userB', adapter);
    const unauth = resourceFor(null, adapter);

    const a = await asA.create({ title: 'A', done: false }); // tenant A's row

    const report = await checkTenantIsolation({
      unauthenticated: [
        { name: 'list', run: () => unauth.list() },
        { name: 'get', run: () => unauth.get(a.id) },
        { name: 'create', run: () => unauth.create({ title: 'x', done: false }) },
        { name: 'update', run: () => unauth.update(a.id, { title: 'x' }) },
        { name: 'remove', run: () => unauth.remove(a.id) },
      ],
      crossTenant: [
        { name: 'get A row as B', run: () => asB.get(a.id), expect: 'empty' },
        { name: 'update A row as B', run: () => asB.update(a.id, { title: 'hacked' }), expect: 'reject' },
        { name: 'remove A row as B', run: () => asB.remove(a.id), expect: 'reject' },
      ],
    });

    expect(report.failed).toEqual([]);
    expect(report.passed).toHaveLength(8);
  });

  it('DETECTS a leak: an unscoped adapter fails the harness', async () => {
    const { adapter } = createMemAdapter();
    // A broken adapter that IGNORES the scope filter on reads (leaks across tenants).
    const leaky: Adapter<null> = {
      ...adapter,
      get: (db, table, idField, id) => adapter.get(db, table, idField, id, { scope: null }),
    };
    const asA = resourceFor('userA', adapter);
    const asB = resourceFor('userB', leaky); // shares the same store as A
    const a = await asA.create({ title: 'A', done: false });

    const report = await checkTenantIsolation({
      crossTenant: [{ name: 'get A row as B (leaky)', run: () => asB.get(a.id), expect: 'empty' }],
    });

    // The harness must CATCH the leak — otherwise it's a rubber stamp.
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.reason).toMatch(/another tenant's data/);
  });

  it('DETECTS a leak: a read returning a non-empty array fails the harness', async () => {
    const report = await checkTenantIsolation({
      crossTenant: [
        {
          name: 'list returns another tenant row',
          run: async () => [{ id: '1', owner_id: 'userA' }],
          expect: 'empty',
        },
      ],
    });

    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.reason).toMatch(/another tenant's data/);
  });

  it('does not throw when a leaked row holds a non-JSON-safe value (bigint)', async () => {
    const bigintLeak: Adapter<null> = {
      list: async () => [],
      get: async () => ({ id: '1', amount: 9007199254740993n }), // leaks a row with a bigint
      create: async () => ({ id: '1' }),
      update: async () => ({ id: '1' }),
      remove: async () => {},
    };
    const asB = resourceFor('userB', bigintLeak);

    // Must resolve to a report (not throw on JSON.stringify) and still record the failure.
    const report = await checkTenantIsolation({
      crossTenant: [{ name: 'get returns bigint row', run: () => asB.get('1'), expect: 'empty' }],
    });
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.reason).toContain('9007199254740993n');
  });

  it('reports every standardized failure branch', async () => {
    const report = await checkTenantIsolation({
      unauthenticated: [{ name: 'list unexpectedly succeeds', run: async () => [] }],
      crossTenant: [
        { name: 'update unexpectedly succeeds', run: async () => ({ id: '1' }), expect: 'reject' },
        {
          name: 'get unexpectedly throws',
          run: async () => {
            throw new Error('db unavailable');
          },
          expect: 'empty',
        },
      ],
    });

    expect(report.passed).toEqual([]);
    expect(report.failed).toEqual([
      {
        name: 'unauthenticated: list unexpectedly succeeds',
        reason: 'did not reject an unauthenticated call',
      },
      {
        name: 'cross-tenant: update unexpectedly succeeds',
        reason: 'a cross-tenant mutation did not reject',
      },
      {
        name: 'cross-tenant: get unexpectedly throws',
        reason: 'a read threw instead of returning empty',
      },
    ]);
  });
});

describe('parent scope (ownedVia) — isolation modes (example-app contract test)', () => {
  type List = { id: string; name: string; owner_id: string };
  type Item = { id: string; title: string; list_id: string };

  function listsResourceFor(userId: string, adapter: Adapter<null>) {
    const { defineResource } = createActionRegistry({
      createContext: async () => ({ db: null, userId }),
      adapter,
    });
    return defineResource<List>()({
      table: 'lists',
      scope: { column: 'owner_id' },
      writableFields: ['name'],
      actions: { create: true },
    });
  }

  function itemsResourceFor(
    userId: string,
    adapter: Adapter<null>,
    listResolver: (ctx: { userId: string }, listId: string) => Promise<string>,
  ) {
    const { defineResource } = createActionRegistry({
      createContext: async () => ({ db: null, userId }),
      adapter,
      scopes: { list: listResolver },
    });
    return defineResource<Item>()({
      table: 'items',
      scope: { column: 'list_id', ownedVia: 'list' },
      writableFields: ['title'],
      actions: { list: true, get: true, create: true, update: true, remove: true },
    });
  }

  it('mode 1 (cross-user parent) rejects; mode 2 (cross-parent child within an owned parent) is empty/rejects', async () => {
    const { adapter, rows } = createMemAdapter();
    // The in-memory equivalent of a real app's resolver querying its parent table.
    const correctResolver = async (ctx: { userId: string }, listId: string): Promise<string> => {
      const list = rows('lists').find((r) => r.id === listId);
      if (!list || list.owner_id !== ctx.userId) throw new Error('List not found');
      return listId;
    };

    const listA1 = await listsResourceFor('userA', adapter).create({ name: 'A1' });
    const listA2 = await listsResourceFor('userA', adapter).create({ name: 'A2' });

    const itemsAsA = itemsResourceFor('userA', adapter, correctResolver);
    const itemsAsB = itemsResourceFor('userB', adapter, correctResolver);
    const itemInA1 = await itemsAsA.create(listA1.id, { title: 'in A1' });
    const itemInA2 = await itemsAsA.create(listA2.id, { title: 'in A2' });

    const report = await checkTenantIsolation({
      crossTenant: [
        // Mode 1: B has no claim on A's list at all — the resolver must THROW (a stronger
        // guarantee than user-scope's cross-tenant read, which returns empty).
        { name: 'items.list(foreign list) as B', run: () => itemsAsB.list(listA1.id), expect: 'reject' },
        {
          name: 'items.get(foreign list, id) as B',
          run: () => itemsAsB.get(listA1.id, itemInA1.id),
          expect: 'reject',
        },
        // Mode 2: A owns listA1, but the item belongs to A's OTHER list — the parent check passes,
        // so the CHILD filter (id AND list_id) must still be what rejects it.
        {
          name: "items.get(A's listA1, item from A's listA2)",
          run: () => itemsAsA.get(listA1.id, itemInA2.id),
          expect: 'empty',
        },
        {
          name: "items.remove(A's listA1, item from A's listA2)",
          run: () => itemsAsA.remove(listA1.id, itemInA2.id),
          expect: 'reject',
        },
      ],
    });

    expect(report.failed).toEqual([]);
    expect(report.passed).toHaveLength(4);
  });

  it("DETECTS a leak: a resolver that doesn't validate ownership fails the harness", async () => {
    const { adapter } = createMemAdapter();
    // Broken resolver: echoes the caller-supplied id with NO ownership check — the exact mistake
    // §5's contract test exists to catch (leaked rows must be SEEN and REPORTED, not just "did not
    // reject", mirroring the existing "unscoped adapter fails the harness" test above).
    const brokenResolver = async (_ctx: { userId: string }, listId: string): Promise<string> => listId;

    const listA1 = await listsResourceFor('userA', adapter).create({ name: 'A1' });
    const itemsAsA = itemsResourceFor('userA', adapter, brokenResolver);
    await itemsAsA.create(listA1.id, { title: 'secret' });
    const itemsAsB = itemsResourceFor('userB', adapter, brokenResolver);

    const report = await checkTenantIsolation({
      crossTenant: [
        {
          name: 'items.list(foreign list) as B (broken resolver)',
          run: () => itemsAsB.list(listA1.id),
          expect: 'empty',
        },
      ],
    });

    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.reason).toMatch(/another tenant's data/);
  });
});
