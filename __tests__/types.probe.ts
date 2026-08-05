/**
 * Compile-only type probe.
 *
 * This file is NOT executed. It asserts the public type surface via explicit
 * annotations and `@ts-expect-error`. `tsc --noEmit` over the project (see
 * `types.test.ts`) fails if any assertion or expected-error is wrong.
 */
import { createActionRegistry, runRevalidation } from '../src';
import type { RevalidationSpec, RevalidationGroups, ActionContext } from '../src';

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
