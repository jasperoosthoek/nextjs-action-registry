/**
 * Tenant-isolation test harness.
 *
 * `action()` returns a bare function and registers no metadata, so the harness can't "enumerate"
 * actions — and custom actions have arbitrary signatures. So the consumer supplies explicit
 * **vectors** (each a `run` closure that invokes an action a particular way) against a seeded
 * two-tenant fixture; the harness standardizes the assertions and collects all failures.
 *
 * Run it against a REAL test DB (RLS/scoping can't be proven against a mock) as the pre-release
 * gate. It is framework-agnostic: it returns a report; your test asserts `report.failed` is empty.
 */
import { inspect } from 'node:util';

/** A cross-tenant probe: invoke an action as tenant B, targeting tenant A's resource. */
export type IsolationVector = {
  /** Human-readable name for the probe. */
  name: string;
  /** Invoke the action (as the *other* tenant, on the first tenant's row). */
  run: () => Promise<unknown>;
  /**
   * The required outcome:
   * - `'reject'` — a mutation must throw (0-row cross-owner write must not silently succeed);
   * - `'empty'` — a read must return `null` or `[]` (never another tenant's data).
   */
  expect: 'reject' | 'empty';
};

/** An unauthenticated probe: invoking the action with a throwing `createContext` must reject. */
export type UnauthVector = {
  name: string;
  run: () => Promise<unknown>;
};

export type IsolationReport = {
  passed: string[];
  failed: { name: string; reason: string }[];
};

function isEmpty(result: unknown): boolean {
  return result === null || (Array.isArray(result) && result.length === 0);
}

// A leaked row may hold non-JSON-safe values (bigint, Date, Map/Set, circular refs). `util.inspect`
// renders any value readably and never throws — so a real-DB harness always returns a complete
// report. (This subpath is testing-only, so depending on `node:util` is fine.)
function describe(value: unknown): string {
  return inspect(value, { depth: 4, breakLength: Infinity });
}

/**
 * Run the isolation probes and collect the results. Assert `report.failed.length === 0` in your
 * test. `create cannot spoof ownership` is domain-specific (read the row back and compare the
 * owner) and should be asserted alongside these.
 */
export async function checkTenantIsolation(opts: {
  unauthenticated?: UnauthVector[];
  crossTenant: IsolationVector[];
}): Promise<IsolationReport> {
  const passed: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const v of opts.unauthenticated ?? []) {
    const label = `unauthenticated: ${v.name}`;
    try {
      await v.run();
      failed.push({ name: label, reason: 'did not reject an unauthenticated call' });
    } catch {
      passed.push(label);
    }
  }

  for (const v of opts.crossTenant) {
    const label = `cross-tenant: ${v.name}`;
    try {
      const result = await v.run();
      if (v.expect === 'reject') {
        failed.push({ name: label, reason: 'a cross-tenant mutation did not reject' });
      } else if (isEmpty(result)) {
        passed.push(label);
      } else {
        failed.push({ name: label, reason: `read returned another tenant's data: ${describe(result)}` });
      }
    } catch {
      if (v.expect === 'reject') passed.push(label);
      else failed.push({ name: label, reason: 'a read threw instead of returning empty' });
    }
  }

  return { passed, failed };
}
