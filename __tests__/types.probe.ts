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

action(async () => null, { revalidate: { tag: 'direct-tag' } });
action(async () => null, { revalidate: { path: '/direct-path' } });
action(async () => true, { revalidate: (result) => (result ? 'tasks' : { tag: 'fallback' }) });

// @ts-expect-error - registry revalidation group names are typed
action(async () => null, { revalidate: 'missingGroup' });

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
type AuditedTask = Task & { created_at: string };

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

reg2.defineResource<Task>()({
  table: 'badTasks',
  scope: { column: 'owner_id' },
  writableFields: ['title'],
  actions: { create: true },
  // @ts-expect-error - generated resource revalidate must use a known group or a direct target
  revalidate: 'missingGroup',
});

reg2.defineResource<Task>()({
  table: 'directTasks',
  scope: { column: 'owner_id' },
  writableFields: ['title'],
  actions: { create: true },
  revalidate: { tag: 'direct-tasks' },
});

const audited = reg2.defineResource<AuditedTask>()({
  table: 'auditedTasks',
  scope: { column: 'owner_id' },
  readonlyFields: ['created_at'],
  writableFields: ['title'],
  actions: { create: true, update: true },
});
const _auditedCreate: (input: { title: string }) => Promise<AuditedTask> = audited.create;
// @ts-expect-error - readonly/server-managed fields are not generated inputs
audited.create({ title: 'x', created_at: 'now' });

reg2.defineResource<AuditedTask>()({
  table: 'badAuditedTasks',
  scope: { column: 'owner_id' },
  readonlyFields: ['created_at'],
  // @ts-expect-error - writableFields must not overlap readonlyFields
  writableFields: ['title', 'created_at'],
  actions: { create: true },
});

// Configured actions exist with the right signatures. get/update/remove accept a bare `string` id
// OR the row itself (Pick<Task, 'id'>) even with idField unconfigured — Task has a usable 'id',
// matching the runtime default (idKey defaults to 'id'); see the "T with no usable 'id'" probe
// further down for the case where no row form is available at all.
const _get: (id: string | Pick<Task, 'id'>) => Promise<Task | null> = tasks.get;
const _rm: (id: string | Pick<Task, 'id'>) => Promise<void> = tasks.remove;
// create input is the full writable allowlist (Pick<T, 'title' | 'done'>):
const _cr: (input: { title: string; done: boolean }) => Promise<Task> = tasks.create;
// update input is a PARTIAL of the allowlist — update some fields, not all:
const _up: (
  id: string | Pick<Task, 'id'>,
  input: Partial<{ title: string; done: boolean }>,
) => Promise<Task> = tasks.update;
tasks.update('id', { title: 'x' }); // partial (only title) is valid
tasks.update('id', {}); // empty is valid
// the row itself also works with idField unconfigured (defaults to the 'id' key):
const _defaultRow: Task = { id: 't1', title: 'x', done: false, owner_id: 'u1' };
tasks.get(_defaultRow);
tasks.update(_defaultRow, { title: 'y' });
tasks.remove(_defaultRow);

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

// ── idField (configurable primary key) ─────────────────────────────────────────

type Task2 = { taskId: string; title: string; done: boolean; owner_id: string };

const tasks2 = reg2.defineResource<Task2>()({
  table: 'tasks2',
  scope: { column: 'owner_id' },
  idField: 'taskId',
  writableFields: ['title', 'done'],
  actions: { get: true, update: true, remove: true },
});

// bare id value accepted:
tasks2.get('t1');
// Pick<T, ID>-shaped object accepted:
tasks2.get({ taskId: 't1' });
// the full row is structurally assignable too (T is assignable to Pick<T, ID>):
const _task2Row: Task2 = { taskId: 't1', title: 'x', done: false, owner_id: 'u1' };
tasks2.update(_task2Row, { title: 'y' });

// @ts-expect-error - id value stays `string` even for a configured idField, not T[ID]
tasks2.get(123);
// @ts-expect-error - an object without the configured key is not accepted
tasks2.remove({ notTaskId: 't1' });

// idField must be a string/number-valued, non-optional, non-nullable key (IdKey<T>) — each
// rejection below is a DIFFERENT reason a key can fail that constraint, so each gets its own probe.
type BadIdObject = { metadata: object; title: string; owner_id: string };
reg2.defineResource<BadIdObject>()({
  table: 'bad1',
  scope: { column: 'owner_id' },
  // @ts-expect-error - an object-valued field is not a valid idField target
  idField: 'metadata',
  actions: { get: true },
});

type BadIdOptional = { nickname?: string; title: string; owner_id: string };
reg2.defineResource<BadIdOptional>()({
  table: 'bad2',
  scope: { column: 'owner_id' },
  // @ts-expect-error - an optional field (T[K] includes undefined) is not a valid idField target
  idField: 'nickname',
  actions: { get: true },
});

type BadIdNullable = { legacyId: string | null; title: string; owner_id: string };
reg2.defineResource<BadIdNullable>()({
  table: 'bad3',
  scope: { column: 'owner_id' },
  // @ts-expect-error - a nullable field (string | null) is not a valid idField target
  idField: 'legacyId',
  actions: { get: true },
});

// A numeric or symbol KEY is rejected even when its VALUE type would otherwise qualify — idField
// names a DB column (a string), so keyof T members that aren't string keys must never be offered.
type BadIdNumericKey = { 42: string; title: string; owner_id: string };
reg2.defineResource<BadIdNumericKey>()({
  table: 'bad4',
  scope: { column: 'owner_id' },
  // @ts-expect-error - a numeric key is not a valid idField target (idField must name a string column)
  idField: 42,
  actions: { get: true },
});

declare const brandSym: unique symbol;
type BadIdSymbolKey = { [brandSym]: string; title: string; owner_id: string };
reg2.defineResource<BadIdSymbolKey>()({
  table: 'bad5',
  scope: { column: 'owner_id' },
  // @ts-expect-error - a symbol key is not a valid idField target
  idField: brandSym,
  actions: { get: true },
});

// ── T with no usable 'id' at all, and idField unconfigured: falls back to `string` only ────────
type NoId = { slug: string; title: string; owner_id: string };
const noIdResource = reg2.defineResource<NoId>()({
  table: 'no_id',
  scope: { column: 'owner_id' },
  actions: { get: true },
});
const _noIdGet: (id: string) => Promise<NoId | null> = noIdResource.get;
// @ts-expect-error - NoId has no usable 'id' field, so only a bare string id is accepted
noIdResource.get({ slug: 'x' });

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
