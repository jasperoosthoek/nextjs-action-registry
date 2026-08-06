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
      get: (db, table, id) => adapter.get(db, table, id, { scope: null }),
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
