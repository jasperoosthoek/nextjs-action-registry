import { unstable_cache } from 'next/cache';

/**
 * Options for `cachedRead`.
 *
 * `scopeKey` is REQUIRED and always prepended to the cache key — pass the `userId` for a per-user
 * read, or a stable sentinel like `'global'` for a shared read. Being required means it can't be
 * forgotten (the common cause of a cross-tenant cache collision); the value is a documented
 * convention, not type-enforced.
 */
export type CachedReadOptions = {
  /** `userId` (per-user) or a sentinel like `'global'` (shared). Always part of the cache key. */
  scopeKey: string;
  /** Additional cache-key parts (e.g. the query shape). */
  keyParts: string[];
  /** Cache tags for `revalidateTag`. */
  tags: string[];
  /** Time-based revalidation (seconds), or `false` to cache until a tag invalidates. */
  revalidate?: number | false;
};

/**
 * Opt-in Data-Cache helper. Wraps `unstable_cache` so a read is persisted across requests and
 * tagged (so `revalidateTag`/`runRevalidation` can bust it).
 *
 * Reads are dynamic by default — reach for this only for expensive or shared reads. The wrapped
 * `fn` MUST NOT call `cookies()`/`headers()` (an `unstable_cache` constraint), so a per-user read
 * needs its `userId` in `scopeKey` and a non-request-scoped client inside `fn`.
 */
export function cachedRead<R>(fn: () => Promise<R>, opts: CachedReadOptions): () => Promise<R> {
  const cacheOptions: { tags: string[]; revalidate?: number | false } = { tags: opts.tags };
  if (opts.revalidate !== undefined) cacheOptions.revalidate = opts.revalidate;
  return unstable_cache(fn, [opts.scopeKey, ...opts.keyParts], cacheOptions);
}
