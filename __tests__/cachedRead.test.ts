import { describe, it, expect, vi, beforeEach } from 'vitest';

// unstable_cache returns a cached version of the fn; our mock returns the fn unchanged so we can
// assert how it was wired AND that the wrapper is callable.
const { unstable_cache } = vi.hoisted(() => ({
  unstable_cache: vi.fn((fn: unknown) => fn),
}));
vi.mock('next/cache', () => ({ unstable_cache }));

import { cachedRead } from '../src/cachedRead';

beforeEach(() => unstable_cache.mockClear());

describe('cachedRead', () => {
  it('prepends scopeKey to the cache key and passes tags + revalidate', async () => {
    const fn = async () => 42;
    const wrapped = cachedRead(fn, {
      scopeKey: 'user1',
      keyParts: ['digest', 'v2'],
      tags: ['digest'],
      revalidate: 300,
    });

    expect(unstable_cache).toHaveBeenCalledWith(fn, ['user1', 'digest', 'v2'], {
      tags: ['digest'],
      revalidate: 300,
    });
    expect(await wrapped()).toBe(42);
  });

  it("uses a 'global' scopeKey for shared reads and omits revalidate when unset", () => {
    cachedRead(async () => 1, { scopeKey: 'global', keyParts: ['rates'], tags: ['rates'] });
    expect(unstable_cache).toHaveBeenCalledWith(expect.any(Function), ['global', 'rates'], {
      tags: ['rates'],
    });
  });
});
