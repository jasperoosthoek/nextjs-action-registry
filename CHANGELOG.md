# Changelog

All notable changes to `@jasperoosthoek/nextjs-action-registry`.

## 0.0.7

- **`cachedRead`** — opt-in Data-Cache helper (wraps `unstable_cache`). `scopeKey` is required and
  always prepended to the cache key (`userId` for per-user, `'global'` for shared), so per-user
  scoping can't be forgotten; `keyParts` + `tags` + optional `revalidate` complete the config.
  Reads stay dynamic by default — reach for this only for expensive or shared reads.
- **Full revalidation model** exercised end-to-end: group names, direct `{ tag }` / `{ path }`
  (with optional `page`/`layout` type), arrays of targets, and result-dependent functions;
  unknown group names fail loud.
- Fix: a typeless path target now calls `revalidatePath(path)` (not `revalidatePath(path, undefined)`).

## 0.0.6

- **Exact type-equality tests** (`expect-type`) covering the generated-CRUD cast boundary: the
  adapter is generic (`unknown`), and `defineResource<T>()` asserts the row type — these prove the
  surfaced signatures for `list`/`get`/`create`/`update`/`remove` are *exactly* right, and that
  `action()` infers the returned signature (ctx stripped, args + result preserved) and that
  unconfigured actions are absent.

## 0.0.5

- **Per-action hooks on `action()`** (all optional, typed to the handler's args + result):
  - `prepare` — validate/guard the input before the handler runs (throw to reject); runs after auth.
  - `onSuccess` — app logic after success, before revalidation; a throw fails the action.
  - `onError` — app logic on failure; guarded so it never masks the original error, never swallows.
    Runs only for **post-auth** failures — an auth/context failure never reaches it (so an
    unauthenticated caller can't trigger action side effects with attacker input); only the
    redacted registry `onError` fires for auth failures.
- **Security note:** `onSuccess`/`onError` receive the raw args/result for app logic and must not
  log them; redacted telemetry stays on the registry-level `onError` (which only gets `{ action }`).

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
