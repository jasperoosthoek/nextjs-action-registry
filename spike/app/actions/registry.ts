import { createActionRegistry } from '@jasperoosthoek/nextjs-action-registry';
import { memAdapter } from '@/app/_lib/store';
import { getCurrentUserId } from '@/app/_lib/user';

export const { defineResource, action } = createActionRegistry({
  createContext: async () => ({ db: null, userId: await getCurrentUserId() }),
  adapter: memAdapter,
  revalidation: {
    tasks: { paths: ['/'] },
    notes: { paths: ['/notes'] },
  },
});
