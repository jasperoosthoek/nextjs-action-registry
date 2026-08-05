import { expectTypeOf } from 'expect-type';
import { createActionRegistry } from '../src';
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
expectTypeOf(tasks.list).toEqualTypeOf<() => Promise<Task[]>>();
expectTypeOf(tasks.get).toEqualTypeOf<(id: string) => Promise<Task | null>>();
expectTypeOf(tasks.create).toEqualTypeOf<(input: Pick<Task, 'title' | 'done'>) => Promise<Task>>();
expectTypeOf(tasks.update).toEqualTypeOf<
  (id: string, input: Partial<Pick<Task, 'title' | 'done'>>) => Promise<Task>
>();
expectTypeOf(tasks.remove).toEqualTypeOf<(id: string) => Promise<void>>();

// create input must not include the ownership column:
expectTypeOf<Parameters<typeof tasks.create>[0]>().not.toHaveProperty('owner_id');

// ── "action exists iff configured": an unconfigured op is not a key of the result ─────────────
const readOnly = defineResource<Task>()({ table: 'catalog', scope: 'public', actions: { get: true } });
expectTypeOf(readOnly).toEqualTypeOf<{ get: (id: string) => Promise<Task | null> }>();
expectTypeOf(readOnly).not.toHaveProperty('remove');
expectTypeOf(readOnly).not.toHaveProperty('create');

// ── action() infers the returned signature exactly (ctx stripped; args + result preserved) ────
const reorder = action(
  async (_ctx, ids: string[], orgId: string): Promise<{ n: number }> => ({ n: ids.length + orgId.length }),
);
expectTypeOf(reorder).toEqualTypeOf<(ids: string[], orgId: string) => Promise<{ n: number }>>();
