'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { switchUser } from '@/app/_lib/user-actions';
import type { DemoUser } from '@/app/_lib/user';

const USERS: DemoUser[] = ['alice', 'bob'];

export function UserSwitcher({ current }: { current: DemoUser }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1 text-sm">
      {USERS.map((u) => (
        <button
          key={u}
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await switchUser(u);
              router.refresh();
            })
          }
          className={`rounded-full px-3 py-1 capitalize transition ${
            u === current ? 'bg-white text-slate-900 shadow' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
