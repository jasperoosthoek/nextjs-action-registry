'use client';
import { useEffect } from 'react';

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export function ErrorState({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <h2 className="text-sm font-semibold text-red-800">Something went wrong</h2>
        <p className="mt-1 text-sm text-red-700">{error.message}</p>
        {error.digest && <p className="mt-1 text-xs text-red-400">Digest: {error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
