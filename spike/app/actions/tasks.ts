'use server';
// Property assignment, NOT destructuring — destructuring these exports breaks the Next build.
import { defineResource, action } from './registry';
import { moveTask } from '@/app/_lib/store';
import type { Task } from '@/types';

const tasks = defineResource<Task>()({
  table: 'tasks',
  scope: { column: 'owner_id' },
  writableFields: ['title', 'done'],
  actions: { list: true, create: true, update: true, remove: true },
  revalidate: 'tasks',
});

export const list = tasks.list;
export const create = tasks.create;
export const update = tasks.update;
export const remove = tasks.remove;

// moveTask() scopes the swap to ctx.userId's own rows — see store.ts.
export const moveUp = action(async (ctx, id: string) => moveTask(ctx.userId, id, 'up'), {
  revalidate: 'tasks',
  name: 'tasks.moveUp',
});
export const moveDown = action(async (ctx, id: string) => moveTask(ctx.userId, id, 'down'), {
  revalidate: 'tasks',
  name: 'tasks.moveDown',
});
