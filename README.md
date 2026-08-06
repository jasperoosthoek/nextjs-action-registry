# @jasperoosthoek/nextjs-action-registry

Declarative CRUD + custom **Next.js Server Actions** — the auth + ownership + cache-revalidation
frame declared once, applied everywhere. Config-driven, typed, datasource-generic via an adapter.

> Status: pre-release (0.0.x). Usable, not yet production-hardened. `v1.0.0` is reserved until it
> has run in a real app in production.

## Quick start

```ts
// registry.ts — wire the app's context, ownership scopes, cache groups, and adapter ONCE.
import { createActionRegistry, supabaseAdapter } from '@jasperoosthoek/nextjs-action-registry';

export const { defineResource, action } = createActionRegistry({
  adapter: supabaseAdapter,
  createContext: async () => {
    const db = await createClient();            // your data client
    const userId = await getUserIdOrThrow(db);  // your auth; throws when unauthenticated
    return { db, userId };                      // may include extras: { db, userId, orgId, locale }
  },
  scopes: {
    org: (ctx, orgId: string) => assertOrgMembership(ctx.db, ctx.userId, orgId),
  },
  revalidation: { tasks: { tags: ['tasks'], paths: ['/tasks'] } },
});
```

```ts
// tasks.ts
'use server';
import { defineResource, action } from './registry';
import type { Task } from '@/types';

const tasks = defineResource<Task>()({
  table: 'tasks',
  scope: { column: 'owner_id' },                // configurable owner column (default 'user_id')
  writableFields: ['title', 'completed'],       // required for create/update — closes mass assignment
  readonlyFields: ['created_at', 'updated_at'], // optional app-managed columns, never writable
  actions: { create: true, update: true, remove: true },
  revalidate: 'tasks',
});

// Export each generated action under its OWN name via property assignment — NOT destructuring
// (destructure breaks the Next build), and NOT renamed aliases. Call sites do `import * as tasks`
// to recover `tasks.create(...)` ergonomics; Next forbids exporting the `tasks` object itself.
export const create = tasks.create;
export const update = tasks.update;
export const remove = tasks.remove;

// Bespoke logic: a standalone action(), exported directly.
export const reorderTasks = action(
  async (ctx, ids: string[], orgId: string) => {
    await ctx.scope.org(orgId);
    /* … ctx.db … */
  },
  { revalidate: 'tasks', name: 'tasks.reorder' },
);
```

## Error handling

NAR is **throw-based**: actions throw on failure and return the value on success. Two things to
know:

- **Client-facing error redaction is Next.js's job, not NAR's.** In production Next replaces a
  thrown server-action error with a generic message + digest to the client and logs the full error
  server-side; in development it shows the error for debugging. NAR deliberately does **not**
  re-wrap or sanitize thrown errors — doing so would break Next's dev visibility and its
  production digest correlation.
- **`onError` is the server-side telemetry hook.** Provide `onError(error, { action })` on the
  registry for logging/metrics. It receives only the error and the action name — **never the
  action arguments** (which may hold sensitive data), so telemetry can't accidentally log them. It
  is guarded: a throwing `onError` never masks the original error, and it never swallows.

Action names in telemetry: pass `name` in `ActionOptions` (generated actions are auto-named
`"<table>.<op>"`, e.g. `"tasks.create"`); otherwise it falls back to `handler.name` or
`"anonymous"`.

## Security model (brief)

- **Fail closed:** a generated mutation with no `scope` or (for create/update) no `writableFields`
  throws at definition time — no silent unscoped writes, no mass assignment.
- **`scope: 'public'` is read-only:** it is the explicit opt-out for global *read* resources.
  Combining it with a generated mutation (`create`/`update`/`remove`) throws — an unscoped write
  must be a bespoke `action()`, never generated.
- **No ownership spoofing:** generated `create` overwrites the owner column from `ctx.userId`.
- **Readonly fields:** add `readonlyFields` for app-managed columns such as timestamps or counters;
  generated `create`/`update` reject any overlap with `writableFields`.
- **Defense in depth:** app-level scope filters sit alongside the datasource's own row security
  (e.g. Postgres RLS). NAR assumes a user-scoped client; a service-role client makes the app-level
  scope the *only* boundary.

## Per-action options

`action(handler, options)` (and, under the hood, generated CRUD) accept:

- `revalidate` — cache invalidation on success (see below).
- `name` — stable name for telemetry (generated actions are auto-named `"<table>.<op>"`).
- `prepare(...args)` — validate/guard the input before the handler runs (**throw to reject**);
  runs *after* auth, so unauthenticated calls never reach it. Transform values in the handler.
- `onSuccess(result, ...args)` — app logic after success, before revalidation; a throw fails it.
- `onError(error, ...args)` — app logic on failure; **only for post-auth failures** (an auth
  failure can't trigger it), guarded so it never masks the original error.

> Security: `onSuccess`/`onError` get the raw args/result for *logic* — never log them. Redacted
> telemetry belongs on the registry-level `onError`, which only receives `{ action }`.

## Revalidation

Declare cache **groups** once (`revalidation` on the registry), then `revalidate` per action:

```ts
revalidation: { tasks: { tags: ['tasks'], paths: ['/tasks', { path: '/', type: 'layout' }] } }
// per action:
revalidate: 'tasks'                              // a group name
revalidate: [{ tag: 'x' }, { path: '/y' }]       // direct targets / arrays
revalidate: (result) => (result ? 'tasks' : [])  // result-dependent
```

When the `revalidation` map is declared inline (or kept as a narrow `const` object — not widened to
`RevalidationGroups`), group names are type-checked: `revalidate: 'tasks'` is accepted if `tasks`
exists in the map; unknown group names are a compile error. Direct `{ tag }` and `{ path }` targets
remain available for one-off invalidation.

## Caching reads

Reads are **dynamic by default** (per-request; `revalidatePath` refreshes them). For an expensive
or shared read, opt into the Data Cache with `cachedRead` — `scopeKey` is required and always in
the cache key (the `userId` for per-user, `'global'` for shared), so per-user scoping can't be
forgotten. The wrapped fn must not call `cookies()`/`headers()`.

```ts
const getRates = cachedRead(() => fetchRates(), { scopeKey: 'global', keyParts: ['rates'], tags: ['rates'], revalidate: 3600 });
```

## Writing an adapter

`supabaseAdapter` is the reference. A custom adapter (Drizzle, Prisma, raw SQL) implements
`Adapter<DB>` — and MUST uphold the security contract documented on the type: reads apply the
scope filter (cross-tenant `get` → `null`), `create` injects the ownership column (no spoofing),
and `update`/`remove` reject a 0-row match (no silent cross-owner writes). **Verify any adapter
with the tenant-isolation harness** (below) against a real DB — the type system can't check these.

## Testing tenant isolation

The `@jasperoosthoek/nextjs-action-registry/testing` subpath ships a vector-driven harness. Wire a
seeded two-tenant fixture and assert `report.failed` is empty — run it against a **real test DB**
as your pre-release gate:

```ts
import { checkTenantIsolation } from '@jasperoosthoek/nextjs-action-registry/testing';

const report = await checkTenantIsolation({
  unauthenticated: [{ name: 'get', run: () => unauth.get(aRowId) }],
  crossTenant: [
    { name: 'get A as B', run: () => asB.get(aRowId), expect: 'empty' },
    { name: 'remove A as B', run: () => asB.remove(aRowId), expect: 'reject' },
  ],
});
expect(report.failed).toEqual([]);
```

## Limitations (v0.x)

Generated CRUD is intentionally narrow while the core is proven; use a bespoke `action()` for
anything outside it:

- **Single-column ownership only.** `scope` is one owner column. Composite/parent scoping (e.g.
  `org_id` *and* `owner_id`) is post-v1 — handle it today with `action()` + `ctx.scope.*`.
- **`id` primary key.** Generated `get`/`update`/`remove` key on an `id` column; tables with a
  differently-named PK use a bespoke `action()`.

## Scripts

`just` lists tasks

## License

MIT © jasperoosthoek
