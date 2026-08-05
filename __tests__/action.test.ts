import { describe, it, expect, vi, beforeEach } from 'vitest';

// The library imports revalidateTag/revalidatePath from 'next/cache'; mock them so the
// primitive is testable without a Next runtime. `vi.hoisted` lets the mock fns be
// referenced inside the hoisted `vi.mock` factory.
const { revalidateTag, revalidatePath } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidateTag, revalidatePath }));

import { createActionRegistry } from '../src/createActionRegistry';

beforeEach(() => {
  revalidateTag.mockClear();
  revalidatePath.mockClear();
});

describe('action() — context + scope + revalidation threading (v0.0.1)', () => {
  it('threads db + userId + pre-bound scope, then revalidates on success', async () => {
    const seen: Record<string, unknown> = {};

    const { action } = createActionRegistry({
      createContext: async () => ({ db: { marker: 'DB' }, userId: 'u1' }),
      scopes: {
        org: async (ctx, orgId: string) => {
          seen.scopeSawUser = ctx.userId; // scope receives the ctx, pre-bound
          return `org:${orgId}`;
        },
      },
      revalidation: { tasks: { tags: ['tasks'], paths: ['/tasks'] } },
    });

    const reorder = action(
      async (ctx, updates: { id: string }[], orgId: string) => {
        seen.userId = ctx.userId;
        seen.db = ctx.db;
        seen.scopeResult = await ctx.scope.org(orgId);
        return { updated: updates.length };
      },
      { revalidate: 'tasks' },
    );

    const result = await reorder([{ id: 'a' }, { id: 'b' }], 'org1');

    expect(result).toEqual({ updated: 2 });
    expect(seen.userId).toBe('u1');
    expect(seen.db).toEqual({ marker: 'DB' });
    expect(seen.scopeResult).toBe('org:org1');
    expect(seen.scopeSawUser).toBe('u1');
    expect(revalidateTag).toHaveBeenCalledWith('tasks');
    expect(revalidatePath).toHaveBeenCalledWith('/tasks');
  });

  it('propagates an unauthenticated createContext throw, fires onError, skips revalidation', async () => {
    const onError = vi.fn();
    const { action } = createActionRegistry({
      createContext: async () => {
        throw new Error('Unauthenticated');
      },
      revalidation: { tasks: { tags: ['tasks'] } },
      onError,
    });

    const act = action(async () => 'ok', { revalidate: 'tasks' });

    await expect(act()).rejects.toThrow('Unauthenticated');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toEqual({ action: expect.any(String) });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('a throwing onError does not mask the original error (#2)', async () => {
    const { action } = createActionRegistry({
      createContext: async () => ({ db: {}, userId: 'u1' }),
      onError: () => {
        throw new Error('telemetry blew up');
      },
    });
    const act = action(async () => {
      throw new Error('real failure');
    });
    // The caller must see the real failure, never the telemetry error.
    await expect(act()).rejects.toThrow('real failure');
  });

  it('passes options.name to onError telemetry (#3)', async () => {
    const onError = vi.fn();
    const { action } = createActionRegistry({
      createContext: async () => ({ db: {}, userId: 'u1' }),
      onError,
    });
    const act = action(
      async () => {
        throw new Error('boom');
      },
      { name: 'tasks.reorder' },
    );
    await expect(act()).rejects.toThrow('boom');
    expect(onError.mock.calls[0]?.[1]).toEqual({ action: 'tasks.reorder' });
  });

  it('a thrown handler rethrows and skips revalidation', async () => {
    const { action } = createActionRegistry({
      createContext: async () => ({ db: {}, userId: 'u1' }),
      revalidation: { tasks: { tags: ['tasks'] } },
    });

    const act = action(
      async () => {
        throw new Error('boom');
      },
      { revalidate: 'tasks' },
    );

    await expect(act()).rejects.toThrow('boom');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('an unknown revalidation group throws (fail-loud)', async () => {
    const { action } = createActionRegistry({
      createContext: async () => ({ db: {}, userId: 'u1' }),
      revalidation: { tasks: { tags: ['tasks'] } },
    });

    const act = action(async () => 'ok', { revalidate: 'nope' });
    await expect(act()).rejects.toThrow(/Unknown revalidation group "nope"/);
  });

  it('omitted revalidate revalidates nothing', async () => {
    const { action } = createActionRegistry({
      createContext: async () => ({ db: {}, userId: 'u1' }),
      revalidation: { tasks: { tags: ['tasks'] } },
    });

    await action(async () => 'ok')();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
