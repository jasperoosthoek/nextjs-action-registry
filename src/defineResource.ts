import type { Adapter, ScopeFilter } from './adapter';
import type { ActionFactory } from './action';
import type { ActionContext, BaseContext, ScopeDefs } from './context';
import type { RevalidationGroups, RevalidationSpec } from './revalidation';

/**
 * Scope-map keys usable as a parent-scope resolver: `S` narrowed to keys whose bound form is
 * callable as `(parentId: string) => Promise<string | number>` — one string parent id in, a
 * non-null id out. A resolver with an extra required arg, a non-string parent-id param, or a
 * nullable/non-primitive return does not qualify (the `extends` check fails), so `ownedVia`
 * pointing at one is a compile error at the config site. The non-null return is deliberate: a
 * parent-scoped child must have a parent, so the resolver must THROW on a foreign one, never
 * return null/undefined. INTERNAL — not re-exported, matching `IdKey<T>`/`IdInput<T, ID>`.
 */
type ParentScopeKey<S> = {
  [K in keyof S]: S[K] extends (ctx: any, parentId: string) => Promise<string | number> ? K : never;
}[keyof S] & string;

/**
 * How a generated resource is owner-scoped. `'user'` is shorthand for `{ column: 'user_id' }`.
 * `'public'` is the explicit opt-out for genuinely global resources (no ownership scoping) — you
 * must write it deliberately; there is no way to leave a resource unscoped by accident.
 * `{ column, ownedVia }` is PARENT scope, for transitive ownership (e.g. an item owned via a list
 * the user owns): `column` is the child's FK to its parent; `ownedVia` names a registered scope
 * resolver that validates the caller-supplied parent id — and MUST throw on a foreign one — before
 * it becomes the filter value.
 *
 * The plain `{ column }` member declares `ownedVia?: undefined` so it can't silently absorb a
 * mistyped/unregistered `ownedVia` value: without that, `{ column, ownedVia: 'nope' }` would still
 * structurally satisfy `{ column: string }` (width subtyping — an object with extra properties is
 * assignable to a type requiring fewer of them) and never get checked against `ParentScopeKey<S>`
 * at all, silently accepting ANY string. The `undefined` discriminant forces the union to route a
 * present `ownedVia` to the parent-scope member, where it's actually validated.
 */
export type ResourceScope<S extends ScopeDefs<any> = ScopeDefs<any>> =
  | 'user'
  | { column: string; ownedVia?: undefined }
  | 'public'
  | { column: string; ownedVia: ParentScopeKey<S> };

/** Which standard actions to generate (each optional; value must be `true`). */
export type ActionsConfig = Partial<Record<'list' | 'get' | 'create' | 'update' | 'remove', true>>;

/**
 * Keys of `T` valid as an `idField`: STRING keys (never `number`/`symbol` — `keyof T` can include
 * those via an index signature or a numeric/symbol property, but `idField` names a DB column, and
 * runtime stringifies it (`String(idField ?? 'id')`) and hands it to adapters as one, so a
 * non-string key would be nonsense here even if its value type were valid) that are also
 * string- or number-VALUED, and non-optional/non-nullable. A union member (`undefined` from an
 * optional prop, `null` from a nullable one) fails `T[K] extends string | number` (a union extends
 * another only if every member does), so such keys are excluded too.
 */
type IdKey<T> = {
  [K in keyof T]: K extends string ? (T[K] extends string | number ? K : never) : never;
}[keyof T];

/** The id key used when `idField` is omitted: `'id'` if `T` actually has a valid one, else none. */
type DefaultIdKey<T> = 'id' extends IdKey<T> ? 'id' : never;

/**
 * The id argument `get`/`update`/`remove` accept: always a bare `string` id value, PLUS a
 * `Pick<T, ID>`-shaped object (e.g. the row itself) — using the *configured* `idField` if one was
 * given, or the *default* `'id'` key if `T` actually has a valid one (matching the runtime, which
 * already defaults `idKey` to `'id'` — the type follows suit, so the row form isn't gated behind
 * explicitly configuring `idField` when the ordinary default already works). Only when neither
 * applies (unconfigured AND `T` has no usable `'id'`) does it fall back to `string` alone — that's
 * also today's pre-`idField` baseline for such a `T`. The id VALUE stays `string` even when the id
 * key is `number`-valued — the adapter boundary and `resolveId` both normalize to `string`, so
 * accepting `T[K]` here would be misleading about what a custom adapter actually receives.
 * `[ID] extends [never]` / `[DefaultIdKey<T>] extends [never]` (not bare `X extends never`) so
 * neither check is distributive. `Pick<T, never>` is deliberately never reached (it would resolve
 * to `{}`, matching almost any value) — the nested conditional only evaluates `Pick<T, ...>` once
 * a real key (`ID` or `DefaultIdKey<T>`) is known.
 */
type IdInput<T, ID extends IdKey<T>> = [ID] extends [never]
  ? [DefaultIdKey<T>] extends [never]
    ? string
    : string | Pick<T, DefaultIdKey<T>>
  : string | Pick<T, ID>;

/**
 * Prepends a leading `parentId: string` argument when `Scope` is the parent-scope form
 * (`{ column; ownedVia }`, matched structurally); otherwise the argument tuple is unchanged. The
 * active parent is per-call UI state, not part of `ctx` — an explicit arg keeps `defineResource`
 * agnostic to which (or how many) parent hierarchies an app has.
 */
type WithParentId<Scope, Args extends unknown[]> = Scope extends { ownedVia: string }
  ? [parentId: string, ...Args]
  : Args;

/**
 * Resource declaration.
 * - `scope` is **required** (a required field, so omitting it is a type error) — every generated
 *   action, reads included, is ownership-scoped unless you opt out with `scope: 'public'`.
 * - `writableFields` is required whenever `create`/`update` is generated (the mass-assignment
 *   allowlist); it must not include the ownership column, `idField`, or any `readonlyFields`.
 *   These are checked at definition/build time (the module is evaluated during `next build`) and
 *   throw if violated.
 */
export type ResourceConfig<
  T,
  W extends keyof T,
  A extends ActionsConfig,
  Groups extends RevalidationGroups = RevalidationGroups,
  R extends keyof T = never,
  ID extends IdKey<T> = never,
  S extends ScopeDefs<any> = ScopeDefs<any>,
  Scope extends ResourceScope<S> = ResourceScope<S>,
> = {
  table: string;
  scope: Scope;
  writableFields?: readonly Exclude<W, R>[];
  /** App-specific server-managed columns, e.g. timestamps, sequence fields, denormalized counters. */
  readonlyFields?: readonly R[];
  /**
   * The PK column `get`/`update`/`remove` key on. Defaults to `'id'`. Configured, those actions
   * accept either the bare id value or a `Pick<T, ID>`-shaped object (e.g. the row itself).
   */
  idField?: ID;
  actions: A;
  revalidate?: RevalidationSpec<Groups>;
};

type Has<A, K extends string> = K extends keyof A ? (A[K] extends true ? true : false) : false;

/**
 * The generated action surface — an action exists iff it was configured. A parent-scoped resource
 * (`scope: { column, ownedVia }`) gains a leading `parentId` argument on every generated op, via
 * `WithParentId`; a user/public-scoped resource is unchanged.
 */
export type GeneratedResource<
  T,
  W extends keyof T,
  A extends ActionsConfig,
  ID extends IdKey<T> = never,
  Scope = ResourceScope<any>,
> = (Has<A, 'list'> extends true
  ? { list: (...args: WithParentId<Scope, []>) => Promise<T[]> }
  : unknown) &
  (Has<A, 'get'> extends true
    ? { get: (...args: WithParentId<Scope, [id: IdInput<T, ID>]>) => Promise<T | null> }
    : unknown) &
  (Has<A, 'create'> extends true
    ? { create: (...args: WithParentId<Scope, [input: Pick<T, W>]>) => Promise<T> }
    : unknown) &
  (Has<A, 'update'> extends true
    ? {
        update: (
          ...args: WithParentId<Scope, [id: IdInput<T, ID>, input: Partial<Pick<T, W>>]>
        ) => Promise<T>;
      }
    : unknown) &
  (Has<A, 'remove'> extends true
    ? { remove: (...args: WithParentId<Scope, [id: IdInput<T, ID>]>) => Promise<void> }
    : unknown);

/** The curried factory returned by `createActionRegistry`. `T` is explicit; the rest is inferred. */
export type DefineResource<
  DB,
  Ctx extends BaseContext<DB>,
  S extends ScopeDefs<Ctx>,
  Groups extends RevalidationGroups = RevalidationGroups,
> = <T>() => <
  const A extends ActionsConfig,
  const R extends keyof T = never,
  const ID extends IdKey<T> = never,
  const Scope extends ResourceScope<S> = ResourceScope<S>,
  W extends keyof T = keyof T,
>(
  config: ResourceConfig<T, W, A, Groups, R, ID, S, Scope>,
) => GeneratedResource<T, W, A, ID, Scope>;

/**
 * The owner/FK column, or `null` for an explicitly `'public'` (unscoped) resource. Works for both
 * user- and parent-scope forms — both carry `.column`; only what fills the filter VALUE differs
 * (`ctx.userId` for user scope vs. a validated parent id for parent scope).
 */
function resolveScopeColumn(scope: ResourceScope<any>): string | null {
  if (scope === 'public') return null;
  return scope === 'user' ? 'user_id' : scope.column;
}

/**
 * Shared value guard for both `idField`'s row/id resolution and a parent-scope resolver's return
 * value — reject null/undefined/non-primitive BEFORE stringifying. Its real value is turning a
 * resolver (or row) that produces a bad value into a LOUD failure instead of a silently bogus
 * `"undefined"` id/filter value. Factored out so the two id-normalization paths can't drift.
 */
function requireIdValue(value: unknown, label: string): string {
  if (value === null || value === undefined) {
    throw new Error(`[nextjs-action-registry] ${label} is missing.`);
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`[nextjs-action-registry] ${label} must be a string or number, got ${typeof value}.`);
  }
  return String(value);
}

/**
 * Build `defineResource`, closing over the registry's adapter + `action` factory. Each generated
 * action runs through `action()` (so it gets the same auth/ctx/scope/revalidation frame), then
 * dispatches to the adapter with the resolved ownership `ScopeFilter`.
 */
export function makeDefineResource<
  DB,
  Ctx extends BaseContext<DB>,
  S extends ScopeDefs<Ctx>,
  Groups extends RevalidationGroups = RevalidationGroups,
>(
  adapter: Adapter<DB> | undefined,
  action: ActionFactory<Ctx, S, Groups>,
): DefineResource<DB, Ctx, S, Groups> {
  const define = <T>() =>
    <
      const A extends ActionsConfig,
      const R extends keyof T = never,
      const ID extends IdKey<T> = never,
      const Scope extends ResourceScope<S> = ResourceScope<S>,
      W extends keyof T = keyof T,
    >(
      config: ResourceConfig<T, W, A, Groups, R, ID, S, Scope>,
    ): GeneratedResource<T, W, A, ID, Scope> => {
      const { table, scope, writableFields, readonlyFields, idField, actions, revalidate } = config;

      if (!adapter) {
        throw new Error(
          '[nextjs-action-registry] defineResource requires an `adapter` in createActionRegistry.',
        );
      }

      // Fail closed: `scope` is required (type-enforced). Runtime guard for JS/`as any` callers.
      if (!scope) {
        throw new Error(
          `[nextjs-action-registry] resource "${table}": \`scope\` is required ` +
            `(use 'user', { column }, or 'public' for an explicitly global resource).`,
        );
      }
      // Fail closed: `scope: 'public'` is a read-only escape hatch. Unscoped generated mutations
      // (create/update/remove) are a mass-mutation hole — use a bespoke action() for those.
      if (scope === 'public' && (actions.create || actions.update || actions.remove)) {
        throw new Error(
          `[nextjs-action-registry] resource "${table}": scope: 'public' cannot be combined with ` +
            `generated mutations — that is an unscoped write. Use a bespoke action() instead.`,
        );
      }
      // Fail closed: create/update need a writable-field allowlist (no mass assignment).
      if ((actions.create || actions.update) && !writableFields) {
        throw new Error(
          `[nextjs-action-registry] resource "${table}": generated create/update require ` +
            `\`writableFields\` (the mass-assignment allowlist).`,
        );
      }

      const column = resolveScopeColumn(scope);
      const idKey = String(idField ?? 'id');
      // Parent scope iff `scope` carries `ownedVia` — the same discriminant ResourceScope<S>'s
      // type uses. `column` is guaranteed non-null whenever `ownedVia` is set (both come from the
      // same union member), so `column!` below is safe. Presence (`!== undefined`), NOT truthiness:
      // a JS/`as any` caller passing `ownedVia: ''` must still be treated as parent-scoped (and
      // then rejected below for naming no registered resolver) — a truthy check would instead fall
      // through to `scopeFor(ctx.userId)`, silently filtering/injecting `column = ctx.userId`.
      const ownedViaRaw: unknown =
        typeof scope === 'object' && scope !== null ? (scope as { ownedVia?: unknown }).ownedVia : undefined;
      if (ownedViaRaw !== undefined && typeof ownedViaRaw !== 'string') {
        throw new Error(
          `[nextjs-action-registry] resource "${table}": \`scope.ownedVia\` must be a string, ` +
            `got ${typeof ownedViaRaw}.`,
        );
      }
      const ownedVia = ownedViaRaw as string | undefined;

      // Fail closed: the ownership column, the (configured or default) id column, and declared
      // readonly fields are never writable (no re-owning, re-keying, or app-managed column writes).
      if (writableFields) {
        const forbidden = new Set<string>([
          idKey,
          ...(column ? [column] : []),
          ...(readonlyFields ?? []).map(String),
        ]);
        for (const w of writableFields) {
          if (forbidden.has(String(w))) {
            throw new Error(
              `[nextjs-action-registry] resource "${table}": writableFields must not include ` +
                `"${String(w)}" — readonly/server-managed fields are never writable.`,
            );
          }
        }
      }

      const scopeFor = (userId: string): ScopeFilter =>
        column ? { column, value: userId } : null;

      // Copy only the allowlisted (writable) fields — mass-assignment prevention. `k` is `keyof T`
      // and `input` is `Pick<T, W>`, so `input[k]` needs no cast.
      const narrow = (input: Partial<Pick<T, W>>): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const k of writableFields ?? []) {
          if (Object.prototype.hasOwnProperty.call(input, k)) out[String(k)] = input[k];
        }
        return out;
      };

      // Resolve an IdInput<T, ID> argument (a bare id value or an id-shaped object) to the bare id
      // string an adapter expects. Runtime backstop for JS/`as any` callers who bypass `IdKey<T>`
      // — same spirit as the `scope` guard above (type-required, still checked at runtime).
      const resolveId = (idOrRow: unknown): string => {
        const raw =
          idOrRow !== null && typeof idOrRow === 'object'
            ? (idOrRow as Record<string, unknown>)[idKey]
            : idOrRow;
        return requireIdValue(raw, `resource "${table}": "${idKey}"`);
      };

      // Resolve the ScopeFilter for one call. Parent-scoped resources split a leading `parentId`
      // off the actual (erased-at-runtime) args and validate it via the registered `ownedVia`
      // resolver BEFORE it becomes the filter value — this is the security linchpin: the resolver
      // MUST throw on a foreign parent (it runs before the adapter is ever touched). The VALIDATED
      // return value fills the filter, not the raw input, so a resolver may canonicalize it. A
      // resolver that returns null/undefined/non-primitive instead of throwing fails LOUD via
      // `requireIdValue`, rather than silently producing a `"undefined"` filter.
      const resolveScope = async (
        ctx: ActionContext<Ctx, S>,
        args: unknown[],
      ): Promise<{ scope: ScopeFilter; rest: unknown[] }> => {
        if (ownedVia === undefined) return { scope: scopeFor(ctx.userId), rest: args };
        const [parentId, ...rest] = args;
        const resolver = (
          ctx.scope as Record<string, ((parentId: unknown) => Promise<unknown>) | undefined>
        )[ownedVia];
        if (!resolver) {
          throw new Error(
            `[nextjs-action-registry] resource "${table}": ownedVia "${ownedVia}" is not a ` +
              `registered scope resolver.`,
          );
        }
        const validated = await resolver(parentId);
        const value = requireIdValue(validated, `resource "${table}": scope "${ownedVia}" resolver return value`);
        return { scope: { column: column!, value }, rest };
      };

      // Name each generated action "<table>.<op>" so registry-level onError telemetry is useful.
      // (No return annotation: the inferred literal has no callback fields, so it's assignable to
      // the per-action ActionOptions<Args, Result> below.)
      const mutOpts = (op: string) =>
        revalidate === undefined ? { name: `${table}.${op}` } : { revalidate, name: `${table}.${op}` };
      const readOpts = (op: string) => ({ name: `${table}.${op}` });

      // Each op is built with EXPLICIT type args to action() — arg + return types are exact
      // (`WithParentId<Scope, ...>` prepends `parentId` iff this resource is parent-scoped, matching
      // GeneratedResource). `args` is untyped-array-cast because that conditional tuple can't be
      // destructured through a generic `Scope` inside the function body; `resolveScope` above is the
      // one place parent-vs-user scope resolution actually differs. The only OTHER cast is a single
      // `as` at the adapter's generic `unknown` return: the sole trust boundary, covered by the probe.
      const list = action<WithParentId<Scope, []>, T[]>(async (ctx, ...args) => {
        const { scope: scopeFilter } = await resolveScope(ctx, args as unknown[]);
        return (await adapter.list(ctx.db, table, { scope: scopeFilter })) as T[];
      }, readOpts('list'));
      const get = action<WithParentId<Scope, [id: IdInput<T, ID>]>, T | null>(async (ctx, ...args) => {
        const { scope: scopeFilter, rest } = await resolveScope(ctx, args as unknown[]);
        const [id] = rest;
        return (await adapter.get(ctx.db, table, idKey, resolveId(id), {
          scope: scopeFilter,
        })) as T | null;
      }, readOpts('get'));
      const create = action<WithParentId<Scope, [input: Pick<T, W>]>, T>(async (ctx, ...args) => {
        const { scope: scopeFilter, rest } = await resolveScope(ctx, args as unknown[]);
        const [input] = rest as [Pick<T, W>];
        return (await adapter.create(ctx.db, table, idKey, narrow(input), {
          scope: scopeFilter,
        })) as T;
      }, mutOpts('create'));
      const update = action<WithParentId<Scope, [id: IdInput<T, ID>, input: Partial<Pick<T, W>>]>, T>(
        async (ctx, ...args) => {
          const { scope: scopeFilter, rest } = await resolveScope(ctx, args as unknown[]);
          const [id, input] = rest as [unknown, Partial<Pick<T, W>>];
          return (await adapter.update(ctx.db, table, idKey, resolveId(id), narrow(input), {
            scope: scopeFilter,
          })) as T;
        },
        mutOpts('update'),
      );
      const remove = action<WithParentId<Scope, [id: IdInput<T, ID>]>, void>(async (ctx, ...args) => {
        const { scope: scopeFilter, rest } = await resolveScope(ctx, args as unknown[]);
        const [id] = rest;
        await adapter.remove(ctx.db, table, idKey, resolveId(id), { scope: scopeFilter });
      }, mutOpts('remove'));

      // Assemble with conditional spreads → a concrete object literal. An action exists on the
      // result iff configured — matching GeneratedResource.
      const resource = {
        ...(actions.list ? { list } : {}),
        ...(actions.get ? { get } : {}),
        ...(actions.create ? { create } : {}),
        ...(actions.update ? { update } : {}),
        ...(actions.remove ? { remove } : {}),
      };

      return resource as GeneratedResource<T, W, A, ID, Scope>;
    };

  return define as DefineResource<DB, Ctx, S, Groups>;
}
