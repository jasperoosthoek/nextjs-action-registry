# Spike — Next.js integration app

This is a standalone Next.js app used to verify that `nextjs-action-registry` works in a real App
Router build. It is not part of the published module.

## What It Checks

- Factory-created CRUD actions exported from `'use server'` files are registered as Server Actions.
- The supported export pattern is property assignment:

  ```ts
  const tasks = defineResource<Task>()({ ... });
  export const create = tasks.create;
  export const update = tasks.update;
  export const remove = tasks.remove;
  ```

- Destructured resource exports are intentionally avoided because Next's action loader has
  previously mis-registered that shape during production builds.
- Custom actions created with `action()` register alongside generated CRUD actions.
- Scoped ownership is applied from server context, not from client input.
- Revalidation groups work for separate task and note routes.

## App Shape

The spike exposes two scoped demo resources:

- `/` lists and mutates tasks.
- `/notes` lists and mutates notes.

The user switcher toggles between `alice` and `bob` using a demo cookie, which makes ownership
scoping visible without adding real authentication.

## Running The Spike

From the repository root:

```bash
npm run test-spike
```

or:

```bash
just test-spike
```

Both commands run the spike app's own production build.

For local interaction:

```bash
just spike
```

The default dev server URL is `http://localhost:3939`.
