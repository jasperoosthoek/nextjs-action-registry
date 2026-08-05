import { describe, it, expect, vi, beforeEach } from 'vitest';

const { revalidateTag, revalidatePath } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidateTag, revalidatePath }));

import { runRevalidation } from '../src/revalidation';
import type { RevalidationGroups } from '../src/revalidation';

const groups: RevalidationGroups = {
  tasks: { tags: ['tasks'], paths: ['/tasks'] },
  home: { tags: ['home'], paths: [{ path: '/', type: 'layout' }] },
  tagsOnly: { tags: ['a', 'b'] },
};

beforeEach(() => {
  revalidateTag.mockClear();
  revalidatePath.mockClear();
});

describe('runRevalidation — full model', () => {
  it('group name → fans out all its tags + paths', () => {
    runRevalidation('tagsOnly', groups, undefined);
    expect(revalidateTag).toHaveBeenCalledWith('a');
    expect(revalidateTag).toHaveBeenCalledWith('b');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a path target with a `type` forwards it to revalidatePath(path, type)', () => {
    runRevalidation('home', groups, undefined);
    expect(revalidateTag).toHaveBeenCalledWith('home');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('direct { tag } and { path } targets', () => {
    runRevalidation({ tag: 'x' }, groups, undefined);
    expect(revalidateTag).toHaveBeenCalledWith('x');

    runRevalidation({ path: '/y' }, groups, undefined);
    expect(revalidatePath).toHaveBeenCalledWith('/y');

    runRevalidation({ path: '/z', type: 'page' }, groups, undefined);
    expect(revalidatePath).toHaveBeenCalledWith('/z', 'page');
  });

  it('an array mixes group names, tags, and paths', () => {
    runRevalidation(['tasks', { tag: 'x' }, { path: '/y' }], groups, undefined);
    expect(revalidateTag).toHaveBeenCalledWith('tasks');
    expect(revalidateTag).toHaveBeenCalledWith('x');
    expect(revalidatePath).toHaveBeenCalledWith('/tasks');
    expect(revalidatePath).toHaveBeenCalledWith('/y');
  });

  it('a function-valued spec is resolved against the result', () => {
    const spec = (result: unknown) => (result ? 'tasks' : { tag: 'none' });
    runRevalidation(spec, groups, true);
    expect(revalidateTag).toHaveBeenCalledWith('tasks');

    revalidateTag.mockClear();
    runRevalidation(spec, groups, false);
    expect(revalidateTag).toHaveBeenCalledWith('none');
  });

  it('a function may return an array', () => {
    runRevalidation(() => ['tasks', { tag: 'extra' }], groups, undefined);
    expect(revalidateTag).toHaveBeenCalledWith('tasks');
    expect(revalidateTag).toHaveBeenCalledWith('extra');
  });

  it('undefined spec revalidates nothing (explicit opt-out)', () => {
    runRevalidation(undefined, groups, undefined);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('an unknown group name throws (fail-loud)', () => {
    expect(() => runRevalidation('nope', groups, undefined)).toThrow(/Unknown revalidation group "nope"/);
  });
});
