'use client';
import * as items from '@/app/actions/items';
import type { Item } from '@/types';
import { useRun } from '@/app/_hooks/useRun';

type Props = {
  item: Item;
};

export function ItemRow({ item }: Props) {
  const { pending, run } = useRun();

  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${pending ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={item.done}
        disabled={pending}
        onChange={run(() => items.update(item.list_id, item, { done: !item.done }))}
        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
      />
      <span className={`flex-1 text-sm ${item.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
        {item.title}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={run(() => items.remove(item.list_id, item))}
        aria-label="Remove"
        className="rounded px-1.5 py-0.5 text-red-400 hover:bg-red-50"
      >
        ✕
      </button>
    </li>
  );
}
