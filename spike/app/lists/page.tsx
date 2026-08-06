import Link from 'next/link';
import * as lists from '@/app/actions/lists';
import { getCurrentUserId } from '@/app/_lib/user';
import { firstListIdFor } from '@/app/_lib/store';
import { NewList } from './new-list';
import { ListRow } from './list-row';

export default async function ListsPage() {
  const userId = await getCurrentUserId();
  const otherUser = userId === 'alice' ? 'bob' : 'alice';
  // The "money shot": a link into a list this user does NOT own — clicking it exercises the
  // parent-scope resolver live, and rejects via app/error.tsx (assertOwnsList in store.ts).
  const foreignListId = firstListIdFor(otherUser);
  const items = await lists.list();

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold">
        Lists <span className="font-normal text-slate-400">({items.length})</span>
      </h1>
      <NewList />
      <ul className="mt-6 space-y-2">
        {items.map((l) => (
          <ListRow key={l.id} list={l} />
        ))}
      </ul>
      {items.length === 0 && <p className="mt-6 text-sm text-slate-500">No lists yet — add one above.</p>}
      {foreignListId && (
        <p className="mt-8 text-sm text-slate-500">
          Parent scope in action:{' '}
          <Link href={`/lists/${foreignListId}`} className="text-indigo-600 hover:underline">
            open {otherUser}&apos;s list
          </Link>{' '}
          — signed in as {userId}, the <code>ownedVia</code> resolver rejects it. Switch users above
          and the same link works.
        </p>
      )}
    </main>
  );
}
