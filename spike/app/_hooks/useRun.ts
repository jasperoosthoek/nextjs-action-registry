'use client';
import { useTransition } from 'react';

// Wraps `useTransition` for the common "call a server action imperatively, track pending" shape.
export function useRun() {
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<unknown>) => () =>
    startTransition(async () => {
      await fn();
    });
  return { pending, run };
}
