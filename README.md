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
  actions: { create: true, update: true, remove: true },
  revalidate: 'tasks',
});

// Export via property assignment — NOT destructuring (destructure breaks the Next build).
export const addTask = tasks.create;
export const deleteTask = tasks.remove;

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
- **Defense in depth:** app-level scope filters sit alongside the datasource's own row security
  (e.g. Postgres RLS). NAR assumes a user-scoped client; a service-role client makes the app-level
  scope the *only* boundary.

## Scripts

`just` lists tasks: `just test`, `just typecheck`, `just build`, `just spike`, `just spike-build`.

## License

MIT © jasperoosthoek
