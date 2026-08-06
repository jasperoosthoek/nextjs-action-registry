'use server';
import { defineResource } from './registry';
import type { Note } from '@/types';

const notes = defineResource<Note>()({
  table: 'notes',
  scope: { column: 'owner_id' },
  writableFields: ['title', 'body'],
  actions: { list: true, create: true, update: true, remove: true },
  revalidate: 'notes',
});

export const list = notes.list;
export const create = notes.create;
export const update = notes.update;
export const remove = notes.remove;
