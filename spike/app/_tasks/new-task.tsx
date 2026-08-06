'use client';
import { useState } from 'react';
import * as tasks from '@/app/actions/tasks';
import { useRun } from '@/app/_hooks/useRun';

export function NewTask() {
  const [title, setTitle] = useState('');
  const { pending, run } = useRun();

  return (
    <div className="mt-4 flex gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New task title"
        className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
      />
      <button
        type="button"
        disabled={pending}
        onClick={run(async () => {
          await tasks.create({ title: title.trim() || 'untitled', done: false });
          setTitle('');
        })}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add task'}
      </button>
    </div>
  );
}
