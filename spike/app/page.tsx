import * as tasks from './actions/tasks';
import { NewTask } from './_tasks/new-task';
import { TaskRow } from './_tasks/task-row';

export default async function TasksPage() {
  const items = await tasks.list();

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold">
        Tasks <span className="font-normal text-slate-400">({items.length})</span>
      </h1>
      <NewTask />
      <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {items.map((t, i) => (
          <TaskRow key={t.id} task={t} isFirst={i === 0} isLast={i === items.length - 1} />
        ))}
      </ul>
      {items.length === 0 && <p className="mt-6 text-sm text-slate-500">No tasks yet — add one above.</p>}
    </main>
  );
}
