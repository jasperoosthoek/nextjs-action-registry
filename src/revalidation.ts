import { revalidateTag, revalidatePath } from 'next/cache';

/**
 * Revalidation model.
 *
 * A resource declares cache "groups" once (tags + route paths). An action then
 * declares `revalidate` referencing a group name, a single `{ tag }` / `{ path }`,
 * an array of those, or a function of the result. `runRevalidation` resolves that
 * spec against the app-provided groups and calls `next/cache`.
 *
 * The library owns only this generic executor — the group map is injected by the app.
 */

/** A single route path to revalidate. `type` matches `revalidatePath`'s 2nd arg. */
export type PathTarget = { path: string; type?: 'page' | 'layout' };

/** An app-defined cache group: a fan-out of cache tags + route paths. */
export type RevalidationGroup = { tags?: string[]; paths?: (string | PathTarget)[] };

/** The app's named cache-group map, injected via `createActionRegistry`. */
export type RevalidationGroups = Record<string, RevalidationGroup>;

/** Extract only concrete string keys; a widened `Record<string, ...>` still accepts any group. */
export type RevalidationGroupName<G extends RevalidationGroups = RevalidationGroups> =
  Extract<keyof G, string>;

/**
 * What an action declares. A bare string is a group name; the objects target one
 * tag / path directly (escape hatch for one-off invalidations).
 */
export type RevalidationTarget<G extends RevalidationGroups = RevalidationGroups> =
  | RevalidationGroupName<G>
  | { tag: string }
  | PathTarget;

/**
 * The `revalidate` option on an action. May be result-dependent via a function.
 * Omitting it entirely means "revalidate nothing" (opt-out is explicit).
 */
export type RevalidationSpec<G extends RevalidationGroups = RevalidationGroups> =
  | RevalidationTarget<G>
  | RevalidationTarget<G>[]
  | ((result: unknown) => RevalidationTarget<G> | RevalidationTarget<G>[]);

function isPathTarget(t: RevalidationTarget): t is PathTarget {
  return typeof t === 'object' && 'path' in t;
}

// Only pass the `type` arg when it's set, so a typeless path is `revalidatePath(path)` — not
// `revalidatePath(path, undefined)` — matching a plain string path.
function doRevalidatePath(path: string, type?: 'page' | 'layout'): void {
  if (type === undefined) revalidatePath(path);
  else revalidatePath(path, type);
}

function revalidateTarget(target: RevalidationTarget, groups: RevalidationGroups): void {
  if (typeof target === 'string') {
    const group = groups[target];
    if (group === undefined) {
      throw new Error(
        `[nextjs-action-registry] Unknown revalidation group "${target}". ` +
          `Declare it in the \`revalidation\` map passed to createActionRegistry.`,
      );
    }
    group.tags?.forEach((tag) => revalidateTag(tag));
    group.paths?.forEach((p) =>
      typeof p === 'string' ? doRevalidatePath(p) : doRevalidatePath(p.path, p.type),
    );
    return;
  }

  if (isPathTarget(target)) {
    doRevalidatePath(target.path, target.type);
    return;
  }

  // { tag }
  revalidateTag(target.tag);
}

/**
 * Resolve a `RevalidationSpec` against the app's groups and fire the matching
 * `revalidateTag` / `revalidatePath` calls. Called only after a handler succeeds
 * (a thrown error skips revalidation, matching hand-written server actions).
 */
export function runRevalidation(
  spec: RevalidationSpec | undefined,
  groups: RevalidationGroups,
  result: unknown,
): void {
  if (spec === undefined) return; // opt-out: revalidate nothing

  const resolved = typeof spec === 'function' ? spec(result) : spec;
  const targets = Array.isArray(resolved) ? resolved : [resolved];
  for (const target of targets) revalidateTarget(target, groups);
}
