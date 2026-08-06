import type { Adapter, ScopeFilter } from './adapter';
import type { ActionFactory } from './action';
import type { BaseContext, ScopeDefs } from './context';
import type { RevalidationGroups, RevalidationSpec } from './revalidation';

/**
 * How a generated resource is owner-scoped. `'user'` is shorthand for `{ column: 'user_id' }`.
 * `'public'` is the explicit opt-out for genuinely global resources (no ownership scoping) — you
 * must write it deliberately; there is no way to leave a resource unscoped by accident.
 */
export type ResourceScope = 'user' | { column: string } | 'public';

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
> = {
  table: string;
  scope: ResourceScope;
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

/** The generated action surface — an action exists iff it was configured. */
export type GeneratedResource<
  T,
  W extends keyof T,
  A extends ActionsConfig,
  ID extends IdKey<T> = never,
> = (Has<A, 'list'> extends true ? { list: () => Promise<T[]> } : unknown) &
  (Has<A, 'get'> extends true ? { get: (id: IdInput<T, ID>) => Promise<T | null> } : unknown) &
  (Has<A, 'create'> extends true ? { create: (input: Pick<T, W>) => Promise<T> } : unknown) &
  (Has<A, 'update'> extends true
    ? { update: (id: IdInput<T, ID>, input: Partial<Pick<T, W>>) => Promise<T> }
    : unknown) &
  (Has<A, 'remove'> extends true ? { remove: (id: IdInput<T, ID>) => Promise<void> } : unknown);

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
  W extends keyof T = keyof T,
>(
  config: ResourceConfig<T, W, A, Groups, R, ID>,
) => GeneratedResource<T, W, A, ID>;

/** The owner column, or `null` for an explicitly `'public'` (unscoped) resource. */
function resolveScopeColumn(scope: ResourceScope): string | null {
  if (scope === 'public') return null;
  return scope === 'user' ? 'user_id' : scope.column;
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
      W extends keyof T = keyof T,
    >(
      config: ResourceConfig<T, W, A, Groups, R, ID>,
    ): GeneratedResource<T, W, A, ID> => {
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
        if (raw === null || raw === undefined) {
          throw new Error(
            `[nextjs-action-registry] resource "${table}": id/row argument is missing "${idKey}".`,
          );
        }
        if (typeof raw !== 'string' && typeof raw !== 'number') {
          throw new Error(
            `[nextjs-action-registry] resource "${table}": "${idKey}" must be a string or number, ` +
              `got ${typeof raw}.`,
          );
        }
        return String(raw);
      };

      // Name each generated action "<table>.<op>" so registry-level onError telemetry is useful.
      // (No return annotation: the inferred literal has no callback fields, so it's assignable to
      // the per-action ActionOptions<Args, Result> below.)
      const mutOpts = (op: string) =>
        revalidate === undefined ? { name: `${table}.${op}` } : { revalidate, name: `${table}.${op}` };
      const readOpts = (op: string) => ({ name: `${table}.${op}` });

      // Each op is built with EXPLICIT type args to action() — arg + return types are exact, with no
      // inference through the enclosing generics (so no loose alias). The only cast is a single `as`
      // at the adapter's generic `unknown` return: the sole trust boundary, covered by the type probe.
      const list = action<[], T[]>(
        async (ctx) => (await adapter.list(ctx.db, table, { scope: scopeFor(ctx.userId) })) as T[],
        readOpts('list'),
      );
      const get = action<[id: IdInput<T, ID>], T | null>(
        async (ctx, id) =>
          (await adapter.get(ctx.db, table, idKey, resolveId(id), {
            scope: scopeFor(ctx.userId),
          })) as T | null,
        readOpts('get'),
      );
      const create = action<[input: Pick<T, W>], T>(
        async (ctx, input) =>
          (await adapter.create(ctx.db, table, idKey, narrow(input), {
            scope: scopeFor(ctx.userId),
          })) as T,
        mutOpts('create'),
      );
      const update = action<[id: IdInput<T, ID>, input: Partial<Pick<T, W>>], T>(
        async (ctx, id, input) =>
          (await adapter.update(ctx.db, table, idKey, resolveId(id), narrow(input), {
            scope: scopeFor(ctx.userId),
          })) as T,
        mutOpts('update'),
      );
      const remove = action<[id: IdInput<T, ID>], void>(async (ctx, id) => {
        await adapter.remove(ctx.db, table, idKey, resolveId(id), { scope: scopeFor(ctx.userId) });
      }, mutOpts('remove'));

      // Assemble with conditional spreads → a concrete object literal, so a SINGLE `as` suffices
      // (no `as unknown`). An action exists on the result iff configured — matching GeneratedResource.
      const resource = {
        ...(actions.list ? { list } : {}),
        ...(actions.get ? { get } : {}),
        ...(actions.create ? { create } : {}),
        ...(actions.update ? { update } : {}),
        ...(actions.remove ? { remove } : {}),
      };

      return resource as GeneratedResource<T, W, A, ID>;
    };

  return define as DefineResource<DB, Ctx, S, Groups>;
}
