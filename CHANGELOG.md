# Changelog

All notable changes to `@jasperoosthoek/nextjs-action-registry`.

## 0.0.4

- **Declarative scope surface** formalized and type-tested: `scope: 'user'` (→ `user_id`),
  `scope: { column }` override, and read-only `scope: 'public'`; `ctx.scope.*` resolvers for
  bespoke handlers.
- **`update` accepts a partial payload** (`Partial<Pick<T, W>>`) — update some writable fields
  without supplying all of them. `create` still requires the full allowlist.

## 0.0.3

- **Tenant-isolation test suite** (end-to-end, in-memory adapter): a user cannot read, update,
  or remove another user's rows; `create` ignores a caller-supplied owner column.
- **Dynamic read model** confirmed: generated `list`/`get` run per-request and are
  ownership-scoped; reads never revalidate and are not Data-Cached (an opt-in cache helper lands
  in a later release).

## 0.0.2

- **`defineResource`** — generate `list` / `get` / `create` / `update` / `remove` from one
  config, exposed for the required property-assignment export pattern (`export const x = tasks.op`).
- **Mass-assignment prevention**: `create`/`update` require a `writableFields` allowlist; `id`
  and the ownership column are never writable.
- **Fail closed**: generated mutations require a `scope`; `scope: 'public'` is read-only;
  create/update require `writableFields`. Violations throw at definition time.
- **No ownership spoofing**: `create` injects the ownership column from `ctx.userId`.
- **`supabaseAdapter`** (structural typing, no `@supabase/supabase-js` dependency): `update` and
  `remove` reject cross-owner (0-row) mutations instead of silently succeeding.
- Removed all `as unknown` casts from `src/`.

## 0.0.1

- **`createActionRegistry`** — the single injection point (data client + auth via
  `createContext`, ownership `scopes`, cache `revalidation` groups, datasource `adapter`).
- **`action()`** — the primitive threading context + `ctx.scope.*` + revalidation; propagates
  the unauthenticated throw; guarded, redacted `onError` (never sees args, never masks the real
  error).
- **`runRevalidation`** over `next/cache`.
- Established the export constraint: server actions must be **property-assignment exports**
  (`export const x = resource.op`) — Next rejects object exports and mis-compiles destructured
  exports from a `'use server'` file.
