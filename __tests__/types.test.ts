import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Type-level test.
 *
 * `types.probe.ts` holds the type assertions (explicit annotations + `@ts-expect-error`).
 * This test runs `tsc --noEmit` over the whole project — which includes the probe — so a
 * wrong assertion or a missing/extra expected-error fails the build here.
 */
describe('type safety', () => {
  it('passes type checking (tsc --noEmit), incl. types.probe.ts', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    try {
      execSync('npx tsc --noEmit', { cwd: root, stdio: 'pipe' });
    } catch (e) {
      const err = e as { status?: number; stdout?: Buffer };
      const status = typeof err.status === 'number' ? ` (exit ${err.status})` : '';
      throw new Error(`Type checking failed${status}\n${err.stdout?.toString() ?? ''}`);
    }
  }, 60_000);
});
