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
      if (op === 'get') return { id: 'row1' };
      // "values"/"patch" payload index (idField was inserted right after `table`): create's is
      // args[3], update's is args[4].
      const values = (op === 'create' ? args[3] : op === 'update' ? args[4] : undefined) ?? {};
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
    expect(call.args[2]).toBe('id'); // idField (default)
    expect(call.args[3]).toEqual({ title: 'x', done: false }); // narrowed — no owner_id, no bogus
    expect(call.args[4]).toEqual({ scope: { column: 'owner_id', value: 'u1' } }); // owner from ctx
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
    expect(call.args[2]).toBe('id'); // idField (default)
    expect(call.args[3]).toBe('t1'); // id
    expect(call.args[4]).toEqual({ title: 'new' }); // owner_id stripped
    expect(call.args[5]).toEqual({ scope: { column: 'user_id', value: 'u1' } });
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
    expect(call.args[2]).toBe('id'); // idField (default)
    expect(call.args[3]).toBe('t1');
    expect(call.args[4]).toEqual({ scope: { column: 'owner_id', value: 'u1' } });
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
    expect(calls[0]?.args[2]).toBe('id'); // idField (default)
    expect(calls[0]?.args[4]).toEqual({ scope: { column: 'owner_id', value: 'u1' } });
  });

  describe('idField (configurable primary key)', () => {
    type TaskCustomId = { taskId: string; title: string; done: boolean; owner_id: string };

    it('idField defaults to "id" when not configured', async () => {
      const { adapter, calls } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      const tasks = defineResource<Task>()({
        table: 'tasks',
        scope: { column: 'owner_id' },
        actions: { get: true },
      });
      await tasks.get('t1');
      expect(calls[0]?.args[2]).toBe('id');
    });

    it('the default (unconfigured idField) resource also accepts the row itself', async () => {
      const { adapter, calls } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      const tasks = defineResource<Task>()({
        table: 'tasks',
        scope: { column: 'owner_id' },
        actions: { get: true },
      });
      const row: Task = { id: 't1', title: 'x', done: false, owner_id: 'u1' };
      await tasks.get(row);
      const call = calls.find((c) => c.op === 'get')!;
      expect(call.args[2]).toBe('id');
      expect(call.args[3]).toBe('t1');
    });

    it('get/update/remove pass the configured idField to the adapter and resolve a bare id value', async () => {
      const { adapter, calls } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      const tasks2 = defineResource<TaskCustomId>()({
        table: 'tasks2',
        scope: { column: 'owner_id' },
        idField: 'taskId',
        writableFields: ['title', 'done'],
        actions: { get: true, update: true, remove: true },
      });

      await tasks2.get('t1');
      await tasks2.update('t1', { title: 'x' });
      await tasks2.remove('t1');

      const g = calls.find((c) => c.op === 'get')!;
      const u = calls.find((c) => c.op === 'update')!;
      const r = calls.find((c) => c.op === 'remove')!;
      expect(g.args[2]).toBe('taskId');
      expect(g.args[3]).toBe('t1');
      expect(u.args[2]).toBe('taskId');
      expect(u.args[3]).toBe('t1');
      expect(r.args[2]).toBe('taskId');
      expect(r.args[3]).toBe('t1');
    });

    it('get/update/remove accept the row itself and resolve the configured idField', async () => {
      const { adapter, calls } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      const tasks2 = defineResource<TaskCustomId>()({
        table: 'tasks2',
        scope: { column: 'owner_id' },
        idField: 'taskId',
        writableFields: ['title', 'done'],
        actions: { get: true, update: true, remove: true },
      });
      const row: TaskCustomId = { taskId: 't1', title: 'x', done: false, owner_id: 'u1' };

      await tasks2.get(row);
      await tasks2.update(row, { title: 'y' });
      await tasks2.remove(row);

      const g = calls.find((c) => c.op === 'get')!;
      const u = calls.find((c) => c.op === 'update')!;
      const r = calls.find((c) => c.op === 'remove')!;
      expect(g.args[3]).toBe('t1');
      expect(u.args[3]).toBe('t1');
      expect(r.args[3]).toBe('t1');
    });

    it('a row missing the configured idField throws', async () => {
      const { adapter } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      const tasks2 = defineResource<TaskCustomId>()({
        table: 'tasks2',
        scope: { column: 'owner_id' },
        idField: 'taskId',
        actions: { get: true },
      });
      await expect(tasks2.get({} as never)).rejects.toThrow(/"taskId" is missing/);
    });

    it('a row with a null idField value throws', async () => {
      const { adapter } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      const tasks2 = defineResource<TaskCustomId>()({
        table: 'tasks2',
        scope: { column: 'owner_id' },
        idField: 'taskId',
        actions: { get: true },
      });
      await expect(tasks2.get({ taskId: null } as never)).rejects.toThrow(/"taskId" is missing/);
    });

    it('a row with a non-primitive idField value throws', async () => {
      const { adapter } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      const tasks2 = defineResource<TaskCustomId>()({
        table: 'tasks2',
        scope: { column: 'owner_id' },
        idField: 'taskId',
        actions: { get: true },
      });
      await expect(tasks2.get({ taskId: {} } as never)).rejects.toThrow(/must be a string or number/);
    });
  });

  describe('parent scope (ownedVia)', () => {
    type Item = { id: string; title: string; done: boolean; list_id: string };

    function setupItems(
      adapter: Adapter<{ tag: 'db' }>,
      list: (ctx: unknown, listId: string) => Promise<string>,
    ) {
      const { defineResource } = createActionRegistry({
        createContext: async () => ({ db: { tag: 'db' as const }, userId: 'u1' }),
        adapter,
        scopes: { list },
        revalidation: { items: { tags: ['items'] } },
      });
      return defineResource<Item>()({
        table: 'items',
        scope: { column: 'list_id', ownedVia: 'list' },
        writableFields: ['title', 'done'],
        actions: { list: true, get: true, create: true, update: true, remove: true },
        revalidate: 'items',
      });
    }

    it('the resolver runs before the adapter, and its VALIDATED return becomes the filter value', async () => {
      const { adapter, calls } = makeFakeAdapter();
      const items = setupItems(adapter, async (_ctx, listId) => `validated-${listId}`);

      await items.list('list1');

      const call = calls.find((c) => c.op === 'list')!;
      // Filter value is the resolver's RETURN (canonicalized), not the raw 'list1' input (DQ2).
      expect(call.args[2]).toEqual({ scope: { column: 'list_id', value: 'validated-list1' } });
    });

    it('a throwing resolver rejects before the adapter is ever called', async () => {
      const { adapter, calls } = makeFakeAdapter();
      const items = setupItems(adapter, async () => {
        throw new Error('List not found');
      });

      await expect(items.list('foreign-list')).rejects.toThrow('List not found');
      expect(calls).toHaveLength(0);
    });

    it('get/create/update/remove all resolve the parent before dispatching, and pass the id/input through', async () => {
      const { adapter, calls } = makeFakeAdapter();
      const items = setupItems(adapter, async (_ctx, listId) => listId);

      await items.get('list1', 'item1');
      await items.create('list1', { title: 'x', done: false });
      await items.update('list1', 'item1', { title: 'y' });
      await items.remove('list1', 'item1');

      const g = calls.find((c) => c.op === 'get')!;
      const c = calls.find((c) => c.op === 'create')!;
      const u = calls.find((c) => c.op === 'update')!;
      const r = calls.find((c) => c.op === 'remove')!;
      expect(g.args[3]).toBe('item1'); // the item id, not swallowed by the parentId split
      expect(g.args[4]).toEqual({ scope: { column: 'list_id', value: 'list1' } });
      expect(c.args[3]).toEqual({ title: 'x', done: false });
      expect(c.args[4]).toEqual({ scope: { column: 'list_id', value: 'list1' } });
      expect(u.args[3]).toBe('item1');
      expect(u.args[4]).toEqual({ title: 'y' });
      expect(u.args[5]).toEqual({ scope: { column: 'list_id', value: 'list1' } });
      expect(r.args[3]).toBe('item1');
      expect(r.args[4]).toEqual({ scope: { column: 'list_id', value: 'list1' } });
    });

    it('a resolver that returns undefined/null/an object fails LOUD instead of a bogus filter (JS/unsafe-caller simulation)', async () => {
      const { adapter } = makeFakeAdapter();

      // `ParentScopeKey<S>` forbids these honestly (no type-safe way to declare such a resolver),
      // so `as never` is the JS/unsafe-caller simulation — there is no type-honest path here.
      const itemsUndefined = setupItems(adapter, async () => undefined as never);
      await expect(itemsUndefined.list('list1')).rejects.toThrow(/is missing/);

      const itemsNull = setupItems(adapter, async () => null as never);
      await expect(itemsNull.list('list1')).rejects.toThrow(/is missing/);

      const itemsObject = setupItems(adapter, async () => ({}) as never);
      await expect(itemsObject.list('list1')).rejects.toThrow(/must be a string or number/);
    });

    it('writableFields containing the parent FK column throws (#idField/#ownedVia)', () => {
      const { adapter } = makeFakeAdapter();
      const { defineResource } = createActionRegistry({
        createContext: async () => ({ db: { tag: 'db' as const }, userId: 'u1' }),
        adapter,
        scopes: { list: async (_ctx: unknown, listId: string) => listId },
      });
      expect(() =>
        defineResource<Item>()({
          table: 'items',
          scope: { column: 'list_id', ownedVia: 'list' },
          writableFields: ['title', 'list_id'],
          actions: { create: true },
        }),
      ).toThrow(/never writable/);
    });

    it('ownedVia: "" (JS/unsafe-caller) rejects — must NOT silently fall back to filtering by ctx.userId', async () => {
      const { adapter, calls } = makeFakeAdapter();
      const { defineResource } = createActionRegistry({
        createContext: async () => ({ db: { tag: 'db' as const }, userId: 'u1' }),
        adapter,
        scopes: { list: async (_ctx: unknown, listId: string) => listId },
      });
      const items = defineResource<Item>()({
        table: 'items',
        // `ownedVia` is type-required to be a real key; cast simulates a JS / `as any` caller
        // passing an empty string (falsy, but NOT "absent" — must still be treated as parent scope).
        scope: { column: 'list_id', ownedVia: '' as never },
        actions: { list: true },
      });
      await expect(items.list('list1')).rejects.toThrow(/not a registered scope resolver/);
      expect(calls).toHaveLength(0); // never reached the adapter with a bogus `list_id = ctx.userId` filter
    });

    it('a non-string ownedVia (JS/unsafe-caller) throws at definition time', () => {
      const { adapter } = makeFakeAdapter();
      const { defineResource } = createActionRegistry({
        createContext: async () => ({ db: { tag: 'db' as const }, userId: 'u1' }),
        adapter,
        scopes: { list: async (_ctx: unknown, listId: string) => listId },
      });
      expect(() =>
        defineResource<Item>()({
          table: 'items',
          scope: { column: 'list_id', ownedVia: 42 } as never,
          actions: { list: true },
        }),
      ).toThrow(/`scope\.ownedVia` must be a string/);
    });
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

    it('writableFields may include a literal "id" field when idField points elsewhere (#idField)', () => {
      type LegacyTask = { taskId: string; id: string; title: string; owner_id: string };
      const { adapter } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      expect(() =>
        defineResource<LegacyTask>()({
          table: 'legacy',
          scope: { column: 'owner_id' },
          idField: 'taskId',
          writableFields: ['title', 'id'],
          actions: { update: true },
        }),
      ).not.toThrow();
    });

    it('writableFields containing the CONFIGURED idField throws, not just a literal "id" (#idField)', () => {
      type LegacyTask = { taskId: string; id: string; title: string; owner_id: string };
      const { adapter } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      expect(() =>
        defineResource<LegacyTask>()({
          table: 'legacy',
          scope: { column: 'owner_id' },
          idField: 'taskId',
          writableFields: ['title', 'taskId'],
          actions: { update: true },
        }),
      ).toThrow(/never writable/);
    });

    it('writableFields containing a declared readonly field throws', () => {
      type AuditedTask = Task & { created_at: string };
      const { adapter } = makeFakeAdapter();
      const { defineResource } = setup(adapter);
      expect(() =>
        defineResource<AuditedTask>()({
          table: 'tasks',
          scope: { column: 'owner_id' },
          readonlyFields: ['created_at'],
          writableFields: ['title', 'created_at'],
          actions: { create: true },
        } as never),
      ).toThrow(/readonly\/server-managed fields are never writable/);
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
