import type { RevalidationGroups, RevalidationSpec } from './revalidation';
import type { ActionContext, ScopeDefs } from './context';

/**
 * Options for a single `action()`.
 *
 * SECURITY: `onSuccess`/`onError` receive the raw args/result for **app logic** (follow-up
 * writes, cleanup) — they must NEVER log them (inputs may hold sensitive data). Redacted
 * telemetry belongs on the registry-level `onError`, which is handed only `{ action }`.
 */
export type ActionOptions<
  Args extends unknown[] = unknown[],
  Result = unknown,
  Groups extends RevalidationGroups = RevalidationGroups,
> = {
  /** Cache invalidation to run after success. */
  revalidate?: RevalidationSpec<Groups>;
  /**
   * Stable name surfaced to the registry-level `onError` as `{ action }`. Recommended, because
   * `handler.name` is empty for the common `action(async (…) => …)` arrow. `defineResource`
   * sets it to `"<table>.<op>"` automatically.
   */
  name?: string;
  /**
   * Validate/guard the input before the handler runs — **throw to reject**. Runs *after* auth, so
   * unauthenticated calls never reach it. The handler receives the original args; do value
   * transformation in the handler itself.
   */
  prepare?: (...args: Args) => void | Promise<void>;
  /**
   * App logic after the handler succeeds (follow-up writes, etc.). Runs before revalidation; a
   * throw here fails the action. Gets the action's args (`prepare` validates, it does not
   * transform) — **app logic, not logging.**
   */
  onSuccess?: (result: Result, ...args: Args) => void | Promise<void>;
  /**
   * App logic on failure (cleanup, custom handling). Does not swallow and cannot mask the original
   * error (it is guarded). Gets the original args — **app logic, not logging.**
   */
  onError?: (error: unknown, ...args: Args) => void | Promise<void>;
};

/**
 * The `action()` primitive, pre-bound to a registry's context/scopes/revalidation.
 * The returned server action preserves the handler's arg types verbatim, minus the
 * injected `ctx`.
 */
export type ActionFactory<
  Ctx,
  S extends ScopeDefs<Ctx>,
  Groups extends RevalidationGroups = RevalidationGroups,
> = <Args extends unknown[], Result>(
  handler: (ctx: ActionContext<Ctx, S>, ...args: Args) => Promise<Result>,
  options?: ActionOptions<Args, Result, Groups>,
) => (...args: Args) => Promise<Result>;
