import * as tasks from './actions';
import { NewTask } from './new-task';

// Server component: reads via `tasks.list()` and renders. `remove` is bound per-row into a form
// (it takes an id, not FormData, and returns void — so it fits the form slot with no cast).
export default async function Page() {
  const items = await tasks.list();

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 480, margin: '2rem auto' }}>
      <h1>Tasks ({items.length})</h1>
      <NewTask create={tasks.create} />
      <ul>
        {items.map((t) => (
          <li key={t.id}>
            {t.title}
            <form action={tasks.remove.bind(null, t.id)} style={{ display: 'inline' }}>
              <button type="submit"> ✕</button>
            </form>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p>No tasks yet — add one above.</p>}
    </main>
  );
}
