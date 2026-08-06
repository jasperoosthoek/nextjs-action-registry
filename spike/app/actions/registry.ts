import { createActionRegistry } from '@jasperoosthoek/nextjs-action-registry';
import { memAdapter, assertOwnsList } from '@/app/_lib/store';
import { getCurrentUserId } from '@/app/_lib/user';

export const { defineResource, action } = createActionRegistry({
  createContext: async () => ({ db: null, userId: await getCurrentUserId() }),
  adapter: memAdapter,
  scopes: {
    // Parent-scope resolver for `items` — throws on a foreign list; see assertOwnsList in store.ts.
    list: async (ctx, listId: string) => assertOwnsList(ctx.userId, listId),
  },
  revalidation: {
    tasks: { paths: ['/'] },
    notes: { paths: ['/notes'] },
    lists: { paths: ['/lists'] },
    items: { paths: ['/lists'] }, // per-list pages revalidate the section
  },
});
