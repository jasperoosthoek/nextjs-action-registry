import type { Adapter } from '../adapter';

/**
 * `supabaseAdapter` — the shipped default datasource adapter.
 *
 * v0.0.1 fixes the type surface only. The real implementation lands in **v0.0.2**,
 * when `defineResource` begins consuming the adapter. Until then every method throws
 * loudly, so a premature wiring mistake surfaces immediately instead of silently.
 */
function notImplemented(op: string): never {
  throw new Error(
    `[nextjs-action-registry] supabaseAdapter.${op} is not implemented until v0.0.2.`,
  );
}

export const supabaseAdapter: Adapter<unknown> = {
  list: () => notImplemented('list'),
  get: () => notImplemented('get'),
  create: () => notImplemented('create'),
  update: () => notImplemented('update'),
  remove: () => notImplemented('remove'),
};
