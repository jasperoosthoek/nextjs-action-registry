'use client';
import { useState } from 'react';
import * as lists from '@/app/actions/lists';
import { useRun } from '@/app/_hooks/useRun';

export function NewList() {
  const [name, setName] = useState('');
  const { pending, run } = useRun();

  return (
    <div className="mt-4 flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New list name"
        className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
      />
      <button
        type="button"
        disabled={pending}
        onClick={run(async () => {
          await lists.create({ name: name.trim() || 'untitled' });
          setName('');
        })}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add list'}
      </button>
    </div>
  );
}
