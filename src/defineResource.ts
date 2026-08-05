import type { Adapter, ScopeFilter } from './adapter';
import type { ActionFactory } from './action';
import type { BaseContext, ScopeDefs } from './context';
import type { RevalidationSpec } from './revalidation';

/**
 * How a generated resource is owner-scoped. `'user'` is shorthand for `{ column: 'user_id' }`.
 * `'public'` is the explicit opt-out for genuinely global resources (no ownership scoping) — you
 * must write it deliberately; there is no way to leave a resource unscoped by accident.
 */
export type ResourceScope = 'user' | { column: string } | 'public';

/** Which standard actions to generate (each optional; value must be `true`). */
export type ActionsConfig = Partial<Record<'list' | 'get' | 'create' | 'update' | 'remove', true>>;

/**
 * Resource declaration.
 * - `scope` is **required** (a required field, so omitting it is a type error) — every generated
 *   action, reads included, is ownership-scoped unless you opt out with `scope: 'public'`.
 * - `writableFields` is required whenever `create`/`update` is generated (the mass-assignment
 *   allowlist); it must not include the ownership column or `id`. Both are checked at
 *   definition/build time (the module is evaluated during `next build`), and throw if violated.
 */
export type ResourceConfig<T, W extends keyof T, A extends ActionsConfig> = {
  table: string;
  scope: ResourceScope;
  writableFields?: readonly W[];
  actions: A;
  revalidate?: RevalidationSpec;
};

type Has<A, K extends string> = K extends keyof A ? (A[K] extends true ? true : false) : false;

/** The generated action surface — an action exists iff it was configured. */
export type GeneratedResource<T, W extends keyof T, A extends ActionsConfig> = (Has<
  A,
  'list'
> extends true
  ? { list: () => Promise<T[]> }
  : unknown) &
  (Has<A, 'get'> extends true ? { get: (id: string) => Promise<T | null> } : unknown) &
  (Has<A, 'create'> extends true ? { create: (input: Pick<T, W>) => Promise<T> } : unknown) &
  (Has<A, 'update'> extends true
    ? { update: (id: string, input: Partial<Pick<T, W>>) => Promise<T> }
    : unknown) &
  (Has<A, 'remove'> extends true ? { remove: (id: string) => Promise<void> } : unknown);

/** The curried factory returned by `createActionRegistry`. `T` is explicit; `W`/`A` are inferred. */
export type DefineResource<DB, Ctx extends BaseContext<DB>, S extends ScopeDefs<Ctx>> = <
  T,
>() => <A extends ActionsConfig, W extends keyof T = keyof T>(
  config: ResourceConfig<T, W, A>,
) => GeneratedResource<T, W, A>;

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
export function makeDefineResource<DB, Ctx extends BaseContext<DB>, S extends ScopeDefs<Ctx>>(
  adapter: Adapter<DB> | undefined,
  action: ActionFactory<Ctx, S>,
): DefineResource<DB, Ctx, S> {
  const define = <T>() =>
    <A extends ActionsConfig, W extends keyof T = keyof T>(
      config: ResourceConfig<T, W, A>,
    ): GeneratedResource<T, W, A> => {
      const { table, scope, writableFields, actions, revalidate } = config;

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

      // Fail closed: the ownership column and `id` are never writable (no re-owning or re-keying).
      // The library can only reject what it knows; server-managed columns (timestamps, etc.) with
      // app-specific names must be left out of `writableFields` by the author.
      if (writableFields) {
        const forbidden = new Set<string>(['id', ...(column ? [column] : [])]);
        for (const w of writableFields) {
          if (forbidden.has(String(w))) {
            throw new Error(
              `[nextjs-action-registry] resource "${table}": writableFields must not include ` +
                `"${String(w)}" — the ownership column and \`id\` are server-managed, never writable.`,
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
      const get = action<[id: string], T | null>(
        async (ctx, id) =>
          (await adapter.get(ctx.db, table, id, { scope: scopeFor(ctx.userId) })) as T | null,
        readOpts('get'),
      );
      const create = action<[input: Pick<T, W>], T>(
        async (ctx, input) =>
          (await adapter.create(ctx.db, table, narrow(input), { scope: scopeFor(ctx.userId) })) as T,
        mutOpts('create'),
      );
      const update = action<[id: string, input: Partial<Pick<T, W>>], T>(
        async (ctx, id, input) =>
          (await adapter.update(ctx.db, table, id, narrow(input), { scope: scopeFor(ctx.userId) })) as T,
        mutOpts('update'),
      );
      const remove = action<[id: string], void>(async (ctx, id) => {
        await adapter.remove(ctx.db, table, id, { scope: scopeFor(ctx.userId) });
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

      return resource as GeneratedResource<T, W, A>;
    };

  return define as DefineResource<DB, Ctx, S>;
}
