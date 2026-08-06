'use client';
import { useState } from 'react';
import * as notes from '@/app/actions/notes';
import { useRun } from '@/app/_hooks/useRun';

export function NewNote() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const { pending, run } = useRun();

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Note title"
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium focus:border-indigo-500 focus:outline-none"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Note body"
        rows={2}
        className="mt-2 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
      />
      <button
        type="button"
        disabled={pending}
        onClick={run(async () => {
          await notes.create({ title: title.trim() || 'untitled', body });
          setTitle('');
          setBody('');
        })}
        className="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add note'}
      </button>
    </div>
  );
}
