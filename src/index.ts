// @jasperoosthoek/nextjs-action-registry — public surface (v0.0.8)

export { createActionRegistry } from './createActionRegistry';
export type { RegistryConfig } from './createActionRegistry';

export { runRevalidation } from './revalidation';
export type {
  RevalidationSpec,
  RevalidationTarget,
  RevalidationGroup,
  RevalidationGroups,
  PathTarget,
} from './revalidation';

export type { ActionOptions, ActionFactory } from './action';
export type { BaseContext, ScopeDefs, BoundScopes, ActionContext } from './context';
export type { Adapter, ScopeFilter } from './adapter';

export type {
  DefineResource,
  ResourceConfig,
  ResourceScope,
  ActionsConfig,
  GeneratedResource,
} from './defineResource';

export { supabaseAdapter } from './adapters/supabase';
export type { SupabaseClientLike } from './adapters/supabase';

export { cachedRead } from './cachedRead';
export type { CachedReadOptions } from './cachedRead';
