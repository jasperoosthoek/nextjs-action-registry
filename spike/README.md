# Spike — server-action registration of factory-returned exports

**Question (gates v0.0.1 API shape):** does Next's compiler register a closure *created by a
library factory* and then *exported from a `'use server'` file* as a Server Action — and in which
authoring forms?

**Environment:** Next.js 15.5.x (App Router), React 19, `next build`.

## Result

| # | Export form | Verdict |
|---|-------------|---------|
| 1 | `export const foo = action(async …)` — **HOF direct** | ✅ **registers**, clean build |
| 3 | `const r = makeResource(); export const foo = r.method` — **property assignment** | ✅ **registers**, clean build |
| 2 | `export const { method: foo } = makeResource()` — **destructure** | ❌ **breaks the build** |

Confirmed via `.next/server/server-reference-manifest.json` (2 action IDs registered for forms 1 + 3).

### Why the destructure form fails

With `export const { remove: viaDestructure } = tasks;`, Next's flight-action loader mis-analyzes
the destructuring and emits a **phantom reference to the inner property name** (`remove`) as if it
were a module export:

```
export 'remove' (reexported as '7f…') was not found in 'app/actions.ts'
  (possible exports: direct, viaDestructure, viaProperty)
…
[cause]: ReferenceError: remove is not defined   // at .next/server/app/page.js
```

The public export (`viaDestructure`) *is* detected, but the extra phantom `remove` binding does not
exist at runtime → `ReferenceError` during page-data collection → build fails.

## Consequence for the library (v0.0.2 `defineResource`)

- **`defineResource` must NOT be consumed via destructured exports.** The documented consumer
  pattern is **property assignment**:

  ```ts
  const tasks = defineResource<Task>()({ … });
  export const deleteTask = tasks.remove;   // ✅ works
  export const updateTask = tasks.update;   // ✅ works
  export const addTask    = tasks.create;   // ✅ works
  // export const { remove: deleteTask } = tasks;  // ❌ breaks the Next build — DO NOT USE
  ```

- The `action()` HOF form (form 1) is unaffected — bespoke actions export directly.

## Running the spike

```bash
cd spike && ../node_modules/.bin/next build
```

`app/actions.ts` currently keeps only the two **passing** forms (the destructure form is documented
in a comment as removed). To reproduce the failure, re-add
`export const { remove: viaDestructure } = tasks;` and wire it into `app/page.tsx`.
