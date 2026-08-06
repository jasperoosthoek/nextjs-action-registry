'use server';
// Property assignment, NOT destructuring — destructuring these exports breaks the Next build.
import { defineResource } from './registry';
import type { List } from '@/types';

const lists = defineResource<List>()({
  table: 'lists',
  scope: { column: 'owner_id' },
  writableFields: ['name'],
  actions: { list: true, create: true, remove: true },
  revalidate: 'lists',
});

export const list = lists.list;
export const create = lists.create;
export const remove = lists.remove;
