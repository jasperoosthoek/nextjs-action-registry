import type { RevalidationSpec } from './revalidation';
import type { ActionContext, ScopeDefs } from './context';

/**
 * Options for a single `action()`.
 *
 * v0.0.1 ships only `{ revalidate }`. The intended extended shape (landing v0.0.5)
 * adds `prepare` / `onSuccess` / `onError` per action — additive and non-breaking:
 *
 *   type ActionOptions<Args, Result> = {
 *     revalidate?: RevalidationSpec;
 *     prepare?:   (...args: Args) => Args | Promise<Args>;   // input validation/transform
 *     onSuccess?: (result: Result, ...args: Args) => void | Promise<void>;  // APP LOGIC, not logging
 *     onError?:   (error: unknown, ...args: Args) => void | Promise<void>;  // APP LOGIC, not logging
 *   };
 *
 * SECURITY: those per-action callbacks receive raw args/result for app logic and must
 * NEVER log them (inputs may hold sensitive data). Redacted telemetry belongs on the
 * registry-level `onError`, which is handed only `{ action }`.
 */
export type ActionOptions = {
  revalidate?: RevalidationSpec;
  /**
   * Stable name surfaced to the registry-level `onError` as `{ action }`. Recommended, because
   * `handler.name` is empty for the common `action(async (…) => …)` arrow. `defineResource`
   * sets it to `"<table>.<op>"` automatically.
   */
  name?: string;
};

/**
 * The `action()` primitive, pre-bound to a registry's context/scopes/revalidation.
 * The returned server action preserves the handler's arg types verbatim, minus the
 * injected `ctx`.
 */
export type ActionFactory<Ctx, S extends ScopeDefs<Ctx>> = <Args extends unknown[], Result>(
  handler: (ctx: ActionContext<Ctx, S>, ...args: Args) => Promise<Result>,
  options?: ActionOptions,
) => (...args: Args) => Promise<Result>;
