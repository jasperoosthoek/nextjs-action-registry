import { runRevalidation, type RevalidationGroups } from './revalidation';
import type { BaseContext, ScopeDefs, BoundScopes, ActionContext } from './context';
import type { Adapter } from './adapter';
import type { ActionFactory, ActionOptions } from './action';
import { makeDefineResource, type DefineResource } from './defineResource';

/**
 * The single injection point. The app wires its data client + auth
 * (`createContext`), ownership resolvers (`scopes`), cache fan-outs (`revalidation`),
 * and datasource `adapter` ONCE; the registry returns factories pre-bound to them.
 *
 * Type params: DB (data client), Ctx (whatever `createContext` returns, ⊇ BaseContext),
 * S (the scopes map, resolving over Ctx).
 */
export type RegistryConfig<DB, Ctx extends BaseContext<DB>, S extends ScopeDefs<Ctx>> = {
  /** Required — the app owns auth; may throw on unauthenticated. May return extras. */
  createContext: () => Promise<Ctx>;
  /**
   * Ownership resolvers exposed to handlers as `ctx.scope.*`. `NoInfer<Ctx>` keeps `Ctx`
   * inferred only from `createContext`, so a scope's `ctx` param is contextually typed (no
   * implicit `any`) while `S` still captures each resolver's own arg types.
   */
  scopes?: S & ScopeDefs<NoInfer<Ctx>>;
  /** Named cache fan-outs. */
  revalidation?: RevalidationGroups;
  /** Required once `defineResource` is used. */
  adapter?: Adapter<DB>;
  /** Redacted telemetry hook. Fires on any error; NEVER receives the action args; does not swallow. */
  onError?: (error: unknown, info: { action: string }) => void;
};

function bindScopes<Ctx, S extends ScopeDefs<Ctx>>(
  scopes: S | undefined,
  ctx: Ctx,
): BoundScopes<S> {
  const bound: Record<string, (...args: any[]) => Promise<unknown>> = {};
  if (scopes) {
    for (const key of Object.keys(scopes)) {
      const fn = scopes[key] as (ctx: Ctx, ...args: any[]) => Promise<unknown>;
      bound[key] = (...args: any[]) => fn(ctx, ...args);
    }
  }
  return bound as BoundScopes<S>;
}

export function createActionRegistry<
  DB,
  Ctx extends BaseContext<DB> = BaseContext<DB>,
  S extends ScopeDefs<Ctx> = {},
>(
  config: RegistryConfig<DB, Ctx, S>,
): { action: ActionFactory<Ctx, S>; defineResource: DefineResource<DB, Ctx, S> } {
  const groups = config.revalidation ?? {};

  const action: ActionFactory<Ctx, S> = (handler, options?: ActionOptions) => {
    return async (...args) => {
      try {
        // createContext may throw on unauthenticated — that propagates.
        const base = await config.createContext();
        const ctx: ActionContext<Ctx, S> = {
          ...base,
          scope: bindScopes(config.scopes, base),
        };

        const result = await handler(ctx, ...args);
        // Only reached on success — a thrown handler skips revalidation.
        runRevalidation(options?.revalidate, groups, result);
        return result;
      } catch (err) {
        // Telemetry only — never swallows, never REPLACES, never sees the args (redaction).
        // Guarded so a throwing onError can't mask the real error.
        if (config.onError) {
          try {
            config.onError(err, { action: options?.name || handler.name || 'anonymous' });
          } catch {
            // telemetry failures must never surface instead of the original error
          }
        }
        throw err;
      }
    };
  };

  const defineResource = makeDefineResource<DB, Ctx, S>(config.adapter, action);

  return { action, defineResource };
}
