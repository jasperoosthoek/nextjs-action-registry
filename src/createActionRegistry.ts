import { runRevalidation, type RevalidationGroups } from './revalidation';
import type { BaseContext, ScopeDefs, BoundScopes, ActionContext } from './context';
import type { Adapter } from './adapter';
import type { ActionFactory } from './action';
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

  const action: ActionFactory<Ctx, S> = (handler, options) => {
    // Registry-level onError: redacted telemetry (only { action }); guarded so it never masks.
    const reportError = (err: unknown): void => {
      if (config.onError) {
        try {
          config.onError(err, { action: options?.name || handler.name || 'anonymous' });
        } catch {
          // telemetry failures must never surface instead of the original error
        }
      }
    };

    return async (...args) => {
      // Auth in its OWN try. An auth failure must NOT reach the per-action, raw-args, app-logic
      // onError — otherwise an unauthenticated caller could trigger side effects with attacker
      // input. Only the redacted registry telemetry runs for unauthenticated calls.
      let base: Ctx;
      try {
        base = await config.createContext();
      } catch (err) {
        reportError(err);
        throw err;
      }

      // Authenticated from here — per-action onError (app logic) is permitted.
      try {
        // Validate/guard the input — a throw here rejects the action.
        if (options?.prepare) await options.prepare(...args);
        const ctx: ActionContext<Ctx, S> = {
          ...base,
          scope: bindScopes(config.scopes, base),
        };

        const result = await handler(ctx, ...args);
        // App logic on success, before revalidation (a throw here fails the action).
        if (options?.onSuccess) await options.onSuccess(result, ...args);
        runRevalidation(options?.revalidate, groups, result);
        return result;
      } catch (err) {
        // Per-action onError (app logic, gets the args) — guarded so it can't mask the error.
        if (options?.onError) {
          try {
            await options.onError(err, ...args);
          } catch {
            // app onError must never surface instead of the original error
          }
        }
        reportError(err);
        throw err;
      }
    };
  };

  const defineResource = makeDefineResource<DB, Ctx, S>(config.adapter, action);

  return { action, defineResource };
}
