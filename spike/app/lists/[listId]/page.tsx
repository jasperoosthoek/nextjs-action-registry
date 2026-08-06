import Link from 'next/link';
import * as items from '@/app/actions/items';
import { NewItem } from './new-item';
import { ItemRow } from './item-row';

export default async function ListPage({ params }: { params: Promise<{ listId: string }> }) {
  const { listId } = await params;
  // Parent-scoped: throws if `listId` isn't owned by the current user (assertOwnsList in store.ts)
  // — a foreign listId lands here via app/error.tsx, not a silently empty/foreign item list.
  const rows = await items.list(listId);

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <Link href="/lists" className="text-sm text-indigo-600 hover:underline">
        ← All lists
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">
        Items <span className="font-normal text-slate-400">({rows.length})</span>
      </h1>
      <NewItem listId={listId} />
      <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {rows.map((it) => (
          <ItemRow key={it.id} item={it} />
        ))}
      </ul>
      {rows.length === 0 && <p className="mt-6 text-sm text-slate-500">No items yet — add one above.</p>}
    </main>
  );
}
