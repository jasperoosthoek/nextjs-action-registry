'use server';
// Property assignment, NOT destructuring — destructuring these exports breaks the Next build.
import { defineResource } from './registry';
import type { Item } from '@/types';

// Parent-scoped: owned via `lists` (a list the caller owns), not a direct `user_id` column — every
// generated op below takes the list id as a leading argument (`items.list(listId)`, etc.).
const items = defineResource<Item>()({
  table: 'items',
  scope: { column: 'list_id', ownedVia: 'list' },
  writableFields: ['title', 'done'],
  actions: { list: true, create: true, update: true, remove: true },
  revalidate: 'items',
});

export const list = items.list;
export const create = items.create;
export const update = items.update;
export const remove = items.remove;
