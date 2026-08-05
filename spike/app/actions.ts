'use server';
// Server-action registration spike: does Next register factory-returned closures, exported
// in each form, as Server Actions? We test three forms in one `'use server'` module.
import { createActionRegistry } from '../../src/index';

const { action } = createActionRegistry({
  createContext: async () => ({ db: null, userId: 'spike-user' }),
});

// ── Form 1: HOF direct export (ecosystem-proven via next-safe-action) ──────────
export const direct = action(async (_ctx, formData: FormData): Promise<void> => {
  void formData.get('x');
});

// Stand-in for v0.0.2's defineResource: a factory returning an object of async fns.
// The bundler behavior — not defineResource's real impl — is what this spike tests.
function makeResource(table: string) {
  return {
    remove: async (formData: FormData): Promise<void> => {
      void `${table}:remove:${formData.get('x')}`;
    },
    update: async (formData: FormData): Promise<void> => {
      void `${table}:update:${formData.get('x')}`;
    },
  };
}

const tasks = makeResource('tasks');

// ── Form 2 (destructured re-export) REMOVED — it broke the Next build:
//    `export const { remove: viaDestructure } = tasks;` emits a phantom reference to
//    the inner name `remove` → `ReferenceError: remove is not defined`. Do not use.

// ── Form 3: property-access assignment ─────────────────────────────────────────
export const viaProperty = tasks.update;
