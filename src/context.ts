/** Injected context + ownership-scope types. */

/** Minimum the library requires from `createContext`. Apps may return a WIDER Ctx. */
export type BaseContext<DB> = { db: DB; userId: string };

/**
 * Scope resolvers as authored in config: the first param is the full ctx (so a scope
 * can read `ctx.tenantId` etc.), the rest are the call args.
 */
export type ScopeDefs<Ctx> = Record<
  string,
  (ctx: Ctx, ...args: any[]) => Promise<unknown>
>;

/** Bound form seen inside handlers: the leading ctx is pre-applied, callers pass only args. */
export type BoundScopes<S extends ScopeDefs<any>> = {
  [K in keyof S]: S[K] extends (ctx: any, ...args: infer A) => infer R
    ? (...args: A) => R
    : never;
};

/** What every handler receives — the app's full Ctx plus the bound scopes. */
export type ActionContext<Ctx, S extends ScopeDefs<Ctx>> = Ctx & {
  scope: BoundScopes<S>;
};
