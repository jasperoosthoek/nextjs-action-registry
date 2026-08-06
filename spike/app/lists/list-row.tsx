'use client';
import Link from 'next/link';
import * as lists from '@/app/actions/lists';
import type { List } from '@/types';
import { useRun } from '@/app/_hooks/useRun';

type Props = {
  list: List;
};

export function ListRow({ list }: Props) {
  const { pending, run } = useRun();

  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 ${pending ? 'opacity-50' : ''}`}
    >
      <Link href={`/lists/${list.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
        {list.name}
      </Link>
      <button
        type="button"
        disabled={pending}
        onClick={run(() => lists.remove(list))}
        aria-label="Remove list"
        className="rounded px-1.5 py-0.5 text-red-400 hover:bg-red-50 disabled:opacity-30"
      >
        ✕
      </button>
    </li>
  );
}
