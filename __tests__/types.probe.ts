/**
 * Compile-only type probe.
 *
 * This file is NOT executed. It asserts the public type surface via explicit
 * annotations and `@ts-expect-error`. `tsc --noEmit` over the project (see
 * `types.test.ts`) fails if any assertion or expected-error is wrong.
 */
import { createActionRegistry, runRevalidation } from '../src';
import type { RevalidationSpec, RevalidationGroups, ActionContext, Adapter } from '../src';

/* eslint-disable @typescript-eslint/no-unused-vars */

type DB = { marker: 'db' };

// ── Ctx inference + extras + scope binding ────────────────────────────────────

const registry = createActionRegistry({
  createContext: async (): Promise<{ db: DB; userId: string; locale: string }> => ({
    db: { marker: 'db' },
    userId: 'u1',
    locale: 'en',
  }),
  scopes: {
    org: async (ctx, orgId: string) => {
      // ctx is fully typed (NoInfer<Ctx>): no implicit any, extras visible.
      const _db: DB = ctx.db;
      const _uid: string = ctx.userId;
      const _loc: string = ctx.locale;
      return `org:${orgId}` as const;
    },
    items: async (ctx, ids: string[], orgId: string) => ids.length + orgId.length,
  },
  revalidation: { tasks: { tags: ['tasks'], paths: ['/tasks'] } },
});

const { action } = registry;

// action() strips the leading ctx and preserves the handler's arg + return types.
const reorder = action(
  async (ctx, updates: { id: string }[], orgId: string): Promise<{ n: number }> => {
    // ctx.scope.org is (orgId: string) => Promise<'org:...'>  — ctx pre-applied.
    const _scoped: string = await ctx.scope.org(orgId);
    const _items: number = await ctx.scope.items(
      updates.map((u) => u.id),
      orgId,
    );
    const _uid: string = ctx.userId;
    const _db: DB = ctx.db;
    const _loc: string = ctx.locale;
    return { n: updates.length };
  },
  { revalidate: 'tasks' },
);

// Returned action: (updates, orgId) => Promise<{ n: number }>  (ctx gone).
const _result: Promise<{ n: number }> = reorder([{ id: 'a' }], 'org1');

// @ts-expect-error - missing the orgId arg
reorder([{ id: 'a' }]);

// @ts-expect-error - wrong arg type
reorder('nope', 'org1');

// ── ActionOptions: prepare / onSuccess / onError are typed to the handler's Args + Result ──────

action(
  async (_ctx, n: number, label: string): Promise<{ ok: boolean }> => ({ ok: n > 0 && label.length > 0 }),
  {
    prepare: (n, label) => {
      // validate/guard — args are typed [number, string]; throw to reject
      if (n < 0 || !label) throw new Error('invalid');
    },
    onSuccess: (result, n, label) => {
      const _r: boolean = result.ok;
      const _n: number = n;
      const _l: string = label;
    },
    onError: (error, n, label) => {
      const _e: unknown = error;
      const _n: number = n;
      const _l: string = label;
    },
  },
);


// ── ctx.scope arg checking ────────────────────────────────────────────────────

action(async (ctx) => {
  // @ts-expect-error - org expects a string, not a number
  await ctx.scope.org(123);
  // @ts-expect-error - no such scope
  await ctx.scope.nope();
  return null;
});

// ── RevalidationSpec accepted forms ───────────────────────────────────────────

const _s1: RevalidationSpec = 'tasks';
const _s2: RevalidationSpec = { tag: 'tasks' };
const _s3: RevalidationSpec = { path: '/tasks' };
const _s4: RevalidationSpec = { path: '/tasks', type: 'layout' };
const _s5: RevalidationSpec = ['tasks', { tag: 'x' }, { path: '/y' }];
const _s6: RevalidationSpec = (result: unknown) => (result ? 'tasks' : { tag: 'x' });
// @ts-expect-error - 'page' | 'layout' only
const _s7: RevalidationSpec = { path: '/tasks', type: 'nope' };

const _groups: RevalidationGroups = { tasks: { tags: ['tasks'], paths: ['/tasks', { path: '/x', type: 'page' }] } };
runRevalidation('tasks', _groups, undefined);

// ── ActionContext shape ───────────────────────────────────────────────────────

type Scopes = { org: (ctx: unknown, orgId: string) => Promise<string> };
type Ctx = { db: DB; userId: string; locale: string };
const _ctx = null as unknown as ActionContext<Ctx, Scopes>;
const _ctxScope: (orgId: string) => Promise<string> = _ctx.scope.org;
const _ctxUser: string = _ctx.userId;

// ── defineResource: conditional generation + writable-field input types ───────

type Task = { id: string; title: string; done: boolean; owner_id: string };

const reg2 = createActionRegistry({
  createContext: async (): Promise<{ db: DB; userId: string }> => ({ db: { marker: 'db' }, userId: 'u' }),
  adapter: {} as Adapter<DB>,
  revalidation: { tasks: { tags: ['tasks'] } },
});

const tasks = reg2.defineResource<Task>()({
  table: 'tasks',
  scope: { column: 'owner_id' },
  writableFields: ['title', 'done'],
  actions: { get: true, create: true, update: true, remove: true },
  revalidate: 'tasks',
});

// Configured actions exist with the right signatures:
const _get: (id: string) => Promise<Task | null> = tasks.get;
const _rm: (id: string) => Promise<void> = tasks.remove;
// create input is the full writable allowlist (Pick<T, 'title' | 'done'>):
const _cr: (input: { title: string; done: boolean }) => Promise<Task> = tasks.create;
// update input is a PARTIAL of the allowlist — update some fields, not all:
const _up: (id: string, input: Partial<{ title: string; done: boolean }>) => Promise<Task> = tasks.update;
tasks.update('id', { title: 'x' }); // partial (only title) is valid
tasks.update('id', {}); // empty is valid

// create requires the full allowlist — a partial create is a type error:
// @ts-expect-error - `done` is required on create
tasks.create({ title: 'x' });

// neither create nor update accepts the ownership column (not in writableFields):
// @ts-expect-error - owner_id is not writable
tasks.create({ title: 'x', done: true, owner_id: 'me' });
// @ts-expect-error - owner_id is not writable
tasks.update('id', { owner_id: 'me' });

// list was not configured → property does not exist:
// @ts-expect-error - list not configured
tasks.list;

// scope is required (fail closed) — omitting it is a type error:
// @ts-expect-error - scope is required
reg2.defineResource<Task>()({ table: 'x', actions: { get: true } });

// 'public' is the explicit unscoped opt-out:
const _pub = reg2.defineResource<Task>()({ table: 'catalog', scope: 'public', actions: { list: true } });
const _pubList: () => Promise<Task[]> = _pub.list;

// Declarative scope surface: 'user' shorthand and { column } override are both accepted:
reg2.defineResource<Task>()({ table: 'a', scope: 'user', actions: { get: true } });
reg2.defineResource<Task>()({ table: 'b', scope: { column: 'account_id' }, actions: { get: true } });
// @ts-expect-error - scope must be 'user' | { column } | 'public'
reg2.defineResource<Task>()({ table: 'c', scope: 'nonsense', actions: { get: true } });

