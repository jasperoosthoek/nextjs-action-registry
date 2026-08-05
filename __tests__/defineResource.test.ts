import { describe, it, expect, vi, beforeEach } from 'vitest';

const { revalidateTag, revalidatePath } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidateTag, revalidatePath }));

import { createActionRegistry } from '../src/createActionRegistry';
import type { Adapter } from '../src/adapter';

type Task = { id: string; title: string; done: boolean; owner_id: string };

// A fake adapter that records every call, so we can assert what defineResource dispatches.
type Call = { op: string; args: unknown[] };
function makeFakeAdapter(): { adapter: Adapter<{ tag: 'db' }>; calls: Call[] } {
  const calls: Call[] = [];
  const rec =
    (op: string) =>
    async (...args: unknown[]): Promise<unknown> => {
      calls.push({ op, args });
      if (op === 'remove') return undefined;
      if (op === 'list') return [{ id: '1' }];
      const values = args[2] ?? {};
      return { id: 'row1', ...(typeof values === 'object' ? values : {}) };
    };
  const adapter = {
    list: rec('list'),
    get: rec('get'),
    create: rec('create'),
    update: rec('update'),
    remove: rec('remove'),
  } as unknown as Adapter<{ tag: 'db' }>;
  return { adapter, calls };
}

function setup(adapter: Adapter<{ tag: 'db' }>) {
  return createActionRegistry({
    createContext: async () => ({ db: { tag: 'db' as const }, userId: 'u1' }),
    adapter,
    revalidation: { tasks: { tags: ['tasks'], paths: ['/tasks'] } },
  });
}

beforeEach(() => {
  revalidateTag.mockClear();
  revalidatePath.mockClear();
});

describe('defineResource — generated CRUD (v0.0.2)', () => {
  it('create narrows to writableFields (drops mass-assignment) and scope carries the owner', async () => {
    const { adapter, calls } = makeFakeAdapter();
    const { defineResource } = setup(adapter);
    const tasks = defineResource<Task>()({
      table: 'tasks',
      scope: { column: 'owner_id' },
      writableFields: ['title', 'done'],
      actions: { create: true },
      revalidate: 'tasks',
    });

    // Caller tries to set owner_id and an unknown field — both must be stripped.
    await tasks.create({ title: 'x', done: false, owner_id: 'attacker', bogus: 1 } as never);

    const call = calls.find((c) => c.op === 'create')!;
    expect(call.args[1]).toBe('tasks'); // table
    expect(call.args[2]).toEqual({ title: 'x', done: false }); // narrowed — no owner_id, no bogus
    expect(call.args[3]).toEqual({ scope: { column: 'owner_id', value: 'u1' } }); // owner from ctx
    expect(revalidateTag).toHaveBeenCalledWith('tasks');
    expect(revalidatePath).toHaveBeenCalledWith('/tasks');
  });

  it('update narrows input and scopes by owner + id', async () => {
    const { adapter, calls } = makeFakeAdapter();
    const { defineResource } = setup(adapter);
    const tasks = defineResource<Task>()({
      table: 'tasks',
      scope: 'user', // shorthand → user_id
      writableFields: ['title'],
      actions: { update: true },
      revalidate: 'tasks',
    });

    await tasks.update('t1', { title: 'new', owner_id: 'x' } as never);

    const call = calls.find((c) => c.op === 'update')!;
    expect(call.args[2]).toBe('t1'); // id
    expect(call.args[3]).toEqual({ title: 'new' }); // owner_id stripped
    expect(call.args[4]).toEqual({ scope: { column: 'user_id', value: 'u1' } });
  });

  it('remove scopes by owner + id and revalidates', async () => {
    const { adapter, calls } = makeFakeAdapter();
    const { defineResource } = setup(adapter);
    const tasks = defineResource<Task>()({
      table: 'tasks',
      scope: { column: 'owner_id' },
      actions: { remove: true },
      revalidate: 'tasks',
    });

    await tasks.remove('t1');

    const call = calls.find((c) => c.op === 'remove')!;
    expect(call.args[2]).toBe('t1');
    expect(call.args[3]).toEqual({ scope: { column: 'owner_id', value: 'u1' } });
    expect(revalidateTag).toHaveBeenCalledWith('tasks');
  });

  it('list is a read: scoped, but does not revalidate', async () => {
    const { adapter, calls } = makeFakeAdapter();
    const { defineResource } = setup(adapter);
    const tasks = defineResource<Task>()({
      table: 'tasks',
      scope: { column: 'owner_id' },
      actions: { list: true },
    });

    await tasks.list();
    expect(calls[0]?.args[2]).toEqual({ scope: { column: 'owner_id', value: 'u1' } });
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('generated actions are auto-named "<table>.<op>" for telemetry (#3)', async () => {
    const { adapter } = makeFakeAdapter();
    const onError = vi.fn();
    const registry = createActionRegistry({
      createContext: async () => ({ db: { tag: 'db' as const }, userId: 'u1' }),
      adapter,
      onError,
    });
    // Force the create to fail by throwing from a bad adapter call path: use a scope + a
    // create whose adapter rejects.
    const failing = {
      ...adapter,
      create: async () => {
        throw new Error('db down');
      },
    } as typeof adapter;
    const reg2 = createActionRegistry({
      createContext: async () => ({ db: { tag: 'db' as const }, userId: 'u1' }),
      adapter: failing,
      onError,
    });
    void registry;
    const tasks = reg2.defineResource<Task>()({
      table: 'tasks',
      scope: { column: 'owner_id' },
      writableFields: ['title'],
      actions: { create: true },
    });
    await expect(tasks.create({ title: 'x' })).rejects.toThrow('db down');
    expect(onError.mock.calls[0]?.[1]).toEqual({ action: 'tasks.create' });
  });

  it('unconfigured actions are absent at runtime', () => {
    const { adapter } = makeFakeAdapter();
    const { defineResource } = setup(adapter);
    const tasks = defineResource<Task>()({
      table: 'tasks',
      scope: { column: 'owner_id' },
      writableFields: ['title'],
      actions: { create: true },
    }) as Record<string, unknown>;
    expect(typeof tasks.create).toBe('function');
    expect(tasks.remove).toBeUndefined();
    expect(tasks.list).toBeUndefined();
  });

  it('scope: "public" allows an explicitly unscoped (global) read resource', async () => {
    const { adapter, calls } = makeFakeAdapter();
    const { defineResource } = setup(adapter);
    const catalog = defineResource<Task>()({
      table: 'catalog',
      scope: 'public',
      actions: { list: true },
    });
    await catalog.list();
    expect(calls[0]?.args[2]).toEqual({ scope: null }); // no ownership filter — by explicit opt-in
  });

  it('reads are scoped too (get carries the owner filter)', async () => {
    const { adapter, calls } = makeFakeAdapter();
    const { defineResource } = setup(adapter);
    const tasks = defineResource<Task>()({
      table: 'tasks',
      scope: { column: 'owner_id' },
      actions: { get: true },
    });
    await tasks.get('t1');
    expect(calls[0]?.args[3]).toEqual({ scope: { column: 'owner_id', value: 'u1' } });
  });

  describe('fail closed (deny by default)', () => {
    it('a resource with no scope throws (runtime guard for JS callers)', () => {
      const { adapter } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      expect(() =>
        // `scope` is type-required; cast simulates a JS / `as any` caller.
        defineResource<Task>()({
          table: 'tasks',
          writableFields: ['title'],
          actions: { update: true },
        } as never),
      ).toThrow(/`scope` is required/);
    });

    it('writableFields containing the ownership column throws (#1)', () => {
      const { adapter } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      expect(() =>
        defineResource<Task>()({
          table: 'tasks',
          scope: { column: 'owner_id' },
          writableFields: ['title', 'owner_id'],
          actions: { update: true },
        }),
      ).toThrow(/never writable/);
    });

    it("scope: 'public' with a generated mutation throws (no unscoped writes)", () => {
      const { adapter } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      expect(() =>
        defineResource<Task>()({
          table: 'catalog',
          scope: 'public',
          writableFields: ['title'],
          actions: { create: true },
        }),
      ).toThrow(/'public' cannot be combined with generated mutations/);
    });

    it('writableFields containing "id" throws (#1)', () => {
      const { adapter } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      expect(() =>
        defineResource<Task>()({
          table: 'tasks',
          scope: { column: 'owner_id' },
          writableFields: ['title', 'id'],
          actions: { create: true },
        }),
      ).toThrow(/never writable/);
    });

    it('create/update without writableFields throws at definition time', () => {
      const { adapter } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      expect(() =>
        defineResource<Task>()({
          table: 'tasks',
          scope: { column: 'owner_id' },
          actions: { create: true },
        }),
      ).toThrow(/require `writableFields`/);
    });

    it('defineResource without an adapter throws', () => {
      const { action, defineResource } = createActionRegistry({
        createContext: async () => ({ db: {}, userId: 'u1' }),
      });
      void action;
      expect(() =>
        defineResource<Task>()({
          table: 'tasks',
          scope: { column: 'owner_id' },
          actions: { list: true },
        }),
      ).toThrow(/requires an `adapter`/);
    });
  });
});
