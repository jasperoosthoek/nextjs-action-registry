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

  it('prepare validates the input (runs after auth) and can reject', async () => {
    const order: string[] = [];
    const { action } = createActionRegistry({
      createContext: async () => {
        order.push('auth');
        return { db: {}, userId: 'u1' };
      },
    });
    const act = action(
      async (_ctx, input: { title: string }) => input.title,
      {
        prepare: (input) => {
          order.push('prepare');
          if (!input.title.trim()) throw new Error('title required');
        },
      },
    );
    // valid input passes:
    expect(await act({ title: 'hi' })).toBe('hi');
    expect(order).toEqual(['auth', 'prepare']); // auth first
    // invalid input is rejected by prepare:
    await expect(act({ title: '   ' })).rejects.toThrow('title required');
  });

  it('onSuccess runs on success (before revalidation) with the args', async () => {
    const onSuccess = vi.fn();
    const { action } = createActionRegistry({
      createContext: async () => ({ db: {}, userId: 'u1' }),
      revalidation: { g: { tags: ['g'] } },
    });
    const act = action(async (_ctx, n: number) => n * 2, { revalidate: 'g', onSuccess });
    const r = await act(10);
    expect(r).toBe(20);
    expect(onSuccess).toHaveBeenCalledWith(20, 10); // result + arg
    expect(revalidateTag).toHaveBeenCalledWith('g');
  });

  it('a throwing onSuccess fails the action and skips revalidation', async () => {
    const { action } = createActionRegistry({
      createContext: async () => ({ db: {}, userId: 'u1' }),
      revalidation: { g: { tags: ['g'] } },
    });
    const act = action(async () => 'ok', {
      revalidate: 'g',
      onSuccess: () => {
        throw new Error('onSuccess boom');
      },
    });
    await expect(act()).rejects.toThrow('onSuccess boom');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('per-action onError fires with the original args and does not mask the error', async () => {
    const perAction = vi.fn();
    const { action } = createActionRegistry({
      createContext: async () => ({ db: {}, userId: 'u1' }),
    });
    const act = action(
      async (_ctx, _id: string) => {
        throw new Error('handler failed');
      },
      { onError: perAction },
    );
    await expect(act('x')).rejects.toThrow('handler failed');
    // onError gets the action's args:
    expect(perAction).toHaveBeenCalledWith(expect.any(Error), 'x');
  });

  it('per-action onError does NOT run on auth failure (only registry telemetry does)', async () => {
    const perAction = vi.fn();
    const registryOnError = vi.fn();
    const { action } = createActionRegistry({
      createContext: async () => {
        throw new Error('Unauthenticated');
      },
      onError: registryOnError,
    });
    const act = action(async (_ctx, _secret: string) => 'ok', { onError: perAction });

    await expect(act('attacker-input')).rejects.toThrow('Unauthenticated');
    // per-action app-logic onError must NOT fire for an unauthenticated caller:
    expect(perAction).not.toHaveBeenCalled();
    // registry redacted telemetry still fires, with only { action }:
    expect(registryOnError).toHaveBeenCalledTimes(1);
    expect(registryOnError.mock.calls[0]?.[1]).toEqual({ action: expect.any(String) });
  });

  it('per-action onError DOES run on a post-auth (handler) failure', async () => {
    const perAction = vi.fn();
    const { action } = createActionRegistry({
      createContext: async () => ({ db: {}, userId: 'u1' }),
    });
    const act = action(
      async () => {
        throw new Error('handler failed');
      },
      { onError: perAction },
    );
    await expect(act()).rejects.toThrow('handler failed');
    expect(perAction).toHaveBeenCalledTimes(1);
  });

  it('a throwing per-action onError still surfaces the original error', async () => {
    const { action } = createActionRegistry({
      createContext: async () => ({ db: {}, userId: 'u1' }),
    });
    const act = action(
      async () => {
        throw new Error('real');
      },
      {
        onError: () => {
          throw new Error('onError blew up');
        },
      },
    );
    await expect(act()).rejects.toThrow('real');
  });

  it('an unknown revalidation group throws (fail-loud)', async () => {
    // No `revalidation` map declared → the group type stays widened (`RevalidationGroups`), so any
    // string is type-legal and no cast is needed. The runtime guard is the backstop here (and the
    // ONLY guard for JS / `as any` callers). The compile-time rejection of an unknown group for a
    // NARROW registry is asserted separately in types.probe.ts.
    const { action } = createActionRegistry({
      createContext: async () => ({ db: {}, userId: 'u1' }),
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
