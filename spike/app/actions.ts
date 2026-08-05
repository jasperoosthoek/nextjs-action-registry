'use server';
// Option A: op-named exports (no invented aliases). Call sites use `import * as tasks` to get
// `tasks.create(...)` ergonomics. Next forbids exporting the `tasks` object itself, so each
// generated action is its own named export.
import { createActionRegistry } from '../../src/index';
import { memAdapter } from './store';

type Task = { id: string; title: string; done: boolean; owner_id: string };

const { defineResource } = createActionRegistry({
  createContext: async () => ({ db: null, userId: 'spike-user' }),
  adapter: memAdapter,
  revalidation: { tasks: { paths: ['/'] } }, // refresh the page after a mutation
});

const tasks = defineResource<Task>()({
  table: 'tasks',
  scope: { column: 'owner_id' },
  writableFields: ['title', 'done'],
  actions: { list: true, create: true, remove: true },
  revalidate: 'tasks',
});

export const list = tasks.list;
export const create = tasks.create;
export const remove = tasks.remove;
