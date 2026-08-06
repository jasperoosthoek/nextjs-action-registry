import { fileURLToPath } from 'node:url';

// The monorepo root — Next already infers this by default (it's the directory holding the outer
// package-lock.json); setting it explicitly just silences the warning instead of changing it.
// Do NOT point this at spike/ itself: it causes an intermittent `PageNotFoundError` during
// `next build`'s page-data-collection step (reproduced on Next 15.5.22).
const monorepoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Spike — minimal Next app to verify server-action registration of factory-returned exports. */
/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingRoot: monorepoRoot,
};
export default nextConfig;
