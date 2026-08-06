import { expectTypeOf } from 'expect-type';
import { createActionRegistry, cachedRead } from '../src';
import type { Adapter } from '../src';

/**
 * Exact type-equality assertions (compile-only; gated by the `tsc --noEmit` run in types.test.ts).
 *
 * This is the F5 coverage: the adapter is generic and returns `unknown`, and `defineResource<T>()`
 * asserts the row type at the cast boundary. These checks prove the *surfaced* types are EXACTLY
 * right — not merely assignable — so a wrong cast can't slip through.
 */
type DB = { marker: 'db' };
type Task = { id: string; title: string; done: boolean; owner_id: string };

const { defineResource, action } = createActionRegistry({
  createContext: async (): Promise<{ db: DB; userId: string }> => ({ db: { marker: 'db' }, userId: 'u' }),
  adapter: {} as Adapter<DB>,
  revalidation: { tasks: { tags: ['tasks'] } },
});

const tasks = defineResource<Task>()({
  table: 'tasks',
  scope: { column: 'owner_id' },
  writableFields: ['title', 'done'],
  actions: { list: true, get: true, create: true, update: true, remove: true },
  revalidate: 'tasks',
});

// ── Generated CRUD surfaces EXACTLY the right signatures (the cast boundary) ───────────────────
// get/update/remove accept a bare `string` id OR the row itself (Pick<Task, 'id'>) — even with
// `idField` unconfigured, since `Task` actually has a usable `'id'` field, matching the runtime
// (which already defaults `idKey` to `'id'`). The row form is NOT gated behind explicitly
// configuring `idField` — see the `idField: 'taskId'` block below for the case where it's needed
// (T's PK isn't named `id`).
expectTypeOf(tasks.list).toEqualTypeOf<() => Promise<Task[]>>();
expectTypeOf(tasks.get).toEqualTypeOf<(id: string | Pick<Task, 'id'>) => Promise<Task | null>>();
expectTypeOf(tasks.create).toEqualTypeOf<(input: Pick<Task, 'title' | 'done'>) => Promise<Task>>();
expectTypeOf(tasks.update).toEqualTypeOf<
  (id: string | Pick<Task, 'id'>, input: Partial<Pick<Task, 'title' | 'done'>>) => Promise<Task>
>();
expectTypeOf(tasks.remove).toEqualTypeOf<(id: string | Pick<Task, 'id'>) => Promise<void>>();

// create input must not include the ownership column:
expectTypeOf<Parameters<typeof tasks.create>[0]>().not.toHaveProperty('owner_id');

// ── Configured idField: same shape, keyed on a differently-named PK ────────────────────────────
type Task2 = { taskId: string; title: string; done: boolean; owner_id: string };

const tasks2 = defineResource<Task2>()({
  table: 'tasks2',
  scope: { column: 'owner_id' },
  idField: 'taskId',
  writableFields: ['title', 'done'],
  actions: { get: true, update: true, remove: true },
});

expectTypeOf(tasks2.get).toEqualTypeOf<(id: string | Pick<Task2, 'taskId'>) => Promise<Task2 | null>>();
expectTypeOf(tasks2.update).toEqualTypeOf<
  (id: string | Pick<Task2, 'taskId'>, input: Partial<Pick<Task2, 'title' | 'done'>>) => Promise<Task2>
>();
expectTypeOf(tasks2.remove).toEqualTypeOf<(id: string | Pick<Task2, 'taskId'>) => Promise<void>>();

// ── T with no usable 'id' at all, and idField unconfigured: falls back to `string` only ────────
type NoId = { slug: string; title: string; owner_id: string };
const noIdResource = defineResource<NoId>()({
  table: 'no_id',
  scope: { column: 'owner_id' },
  actions: { get: true },
});
expectTypeOf(noIdResource.get).toEqualTypeOf<(id: string) => Promise<NoId | null>>();

// ── "action exists iff configured": an unconfigured op is not a key of the result ─────────────
const readOnly = defineResource<Task>()({ table: 'catalog', scope: 'public', actions: { get: true } });
expectTypeOf(readOnly).toEqualTypeOf<{ get: (id: string | Pick<Task, 'id'>) => Promise<Task | null> }>();
expectTypeOf(readOnly).not.toHaveProperty('remove');
expectTypeOf(readOnly).not.toHaveProperty('create');

// ── action() infers the returned signature exactly (ctx stripped; args + result preserved) ────
const reorder = action(
  async (_ctx, ids: string[], orgId: string): Promise<{ n: number }> => ({ n: ids.length + orgId.length }),
);
expectTypeOf(reorder).toEqualTypeOf<(ids: string[], orgId: string) => Promise<{ n: number }>>();

// ── cachedRead preserves the read's return type; scopeKey/keyParts/tags are required ──────────
const cached = cachedRead(async (): Promise<number> => 1, {
  scopeKey: 'global',
  keyParts: ['rates'],
  tags: ['rates'],
});
expectTypeOf(cached).toEqualTypeOf<() => Promise<number>>();

// @ts-expect-error - scopeKey is required (can't forget to scope the cache key)
cachedRead(async () => 1, { keyParts: ['x'], tags: ['x'] });
