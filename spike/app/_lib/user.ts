import { cookies } from 'next/headers';

// Demo-only stand-in for real auth (a real app's `createContext` would call actual auth here).
export const DEMO_USER_COOKIE = 'nar-spike-user';
export type DemoUser = 'alice' | 'bob';

export async function getCurrentUserId(): Promise<DemoUser> {
  const store = await cookies();
  return store.get(DEMO_USER_COOKIE)?.value === 'bob' ? 'bob' : 'alice';
}
