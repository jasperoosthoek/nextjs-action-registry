'use server';
import { cookies } from 'next/headers';
import { DEMO_USER_COOKIE, type DemoUser } from './user';

export async function switchUser(user: DemoUser): Promise<void> {
  const store = await cookies();
  store.set(DEMO_USER_COOKIE, user);
}
