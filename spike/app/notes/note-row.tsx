'use client';
import { useState } from 'react';
import * as notes from '@/app/actions/notes';
import type { Note } from '@/types';
import { useRun } from '@/app/_hooks/useRun';

type Props = {
  note: Note;
};

export function NoteRow({ note }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const { pending, run } = useRun();

  const cancel = () => {
    setTitle(note.title);
    setBody(note.body);
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="rounded-lg border border-indigo-200 bg-white p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm font-medium focus:border-indigo-500 focus:outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={run(async () => {
              await notes.update(note, { title, body });
              setEditing(false);
            })}
            className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={cancel} className="rounded-md px-3 py-1 text-sm text-slate-500 hover:text-slate-700">
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-slate-900">{note.title}</h3>
        <div className="flex shrink-0 gap-2 text-sm">
          <button type="button" onClick={() => setEditing(true)} className="text-indigo-600 hover:underline">
            Edit
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={run(() => notes.remove(note))}
            className="text-red-500 hover:underline disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{note.body}</p>
    </li>
  );
}
