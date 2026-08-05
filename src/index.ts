// @jasperoosthoek/nextjs-action-registry — public surface (v0.0.1)

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

export { supabaseAdapter } from './adapters/supabase';
