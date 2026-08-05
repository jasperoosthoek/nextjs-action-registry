'use client';
import { useState, useTransition } from 'react';

// Client component: calls the `create` server action (passed as a typed prop). After it resolves,
// the action's revalidatePath('/') has already refreshed the server-rendered list.
type Props = {
  create: (input: { title: string; done: boolean }) => Promise<unknown>;
};

export function NewTask({ create }: Props) {
  const [title, setTitle] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="new task title" />
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await create({ title: title.trim() || 'untitled', done: false });
            setTitle('');
          })
        }
      >
        {pending ? 'adding…' : 'add task'}
      </button>
    </div>
  );
}
