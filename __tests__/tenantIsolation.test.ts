import { describe, it, expect, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { createActionRegistry } from '../src';
import type { Adapter } from '../src';
import { createMemAdapter } from './support/memAdapter';

type Task = { id: string; title: string; done: boolean; owner_id: string };

// A resource generated for a specific authenticated user, sharing one adapter/store.
function resourceFor(userId: string, adapter: Adapter<null>) {
  const { defineResource } = createActionRegistry({
    createContext: async () => ({ db: null, userId }),
    adapter,
  });
  return defineResource<Task>()({
    table: 'tasks',
    scope: { column: 'owner_id' },
    writableFields: ['title', 'done'],
    actions: { list: true, get: true, create: true, update: true, remove: true },
  });
}

describe('tenant isolation (end-to-end, in-memory adapter)', () => {
  it('a user cannot read, update, or remove another user\'s rows', async () => {
    const { adapter } = createMemAdapter();
    const asA = resourceFor('userA', adapter);
    const asB = resourceFor('userB', adapter);

    const a = await asA.create({ title: 'A task', done: false });
    const b = await asB.create({ title: 'B task', done: false });

    // create injects the owner from ctx.userId — not from caller input.
    expect(a.owner_id).toBe('userA');
    expect(b.owner_id).toBe('userB');

    // list is ownership-scoped: A sees only A's row.
    const listA = await asA.list();
    expect(listA).toHaveLength(1);
    expect(listA[0]?.id).toBe(a.id);

    // get across owners returns null (no leak); own row is returned.
    expect(await asA.get(b.id)).toBeNull();
    expect((await asA.get(a.id))?.id).toBe(a.id);

    // update / remove across owners reject (0-row → error), not silent success.
    await expect(asA.update(b.id, { title: 'hacked' })).rejects.toThrow();
    await expect(asA.remove(b.id)).rejects.toThrow();

    // B's row is untouched.
    expect((await asB.get(b.id))?.title).toBe('B task');
  });

  it('create ignores a caller-supplied owner column (no spoofing)', async () => {
    const { adapter } = createMemAdapter();
    const asA = resourceFor('userA', adapter);

    // owner_id is not in writableFields, so it is stripped; the adapter injects userA.
    const created = await asA.create({ title: 'x', done: false, owner_id: 'userB' } as never);
    expect(created.owner_id).toBe('userA');
  });

  it('reads are dynamic and never revalidate', async () => {
    const cache = await import('next/cache');
    const { adapter } = createMemAdapter();
    const asA = resourceFor('userA', adapter);

    (cache.revalidateTag as ReturnType<typeof vi.fn>).mockClear();
    (cache.revalidatePath as ReturnType<typeof vi.fn>).mockClear();

    await asA.list();
    await asA.get('nope');

    expect(cache.revalidateTag).not.toHaveBeenCalled();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});
