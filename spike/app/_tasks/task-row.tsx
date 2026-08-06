'use client';
import * as tasks from '@/app/actions/tasks';
import type { Task } from '@/types';
import { useRun } from '@/app/_hooks/useRun';

type Props = {
  task: Task;
  isFirst: boolean;
  isLast: boolean;
};

export function TaskRow({ task, isFirst, isLast }: Props) {
  const { pending, run } = useRun();

  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${pending ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={task.done}
        disabled={pending}
        onChange={run(() => tasks.update(task, { done: !task.done }))}
        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
      />
      <span className={`flex-1 text-sm ${task.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
        {task.title}
      </span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          disabled={pending || isFirst}
          onClick={run(() => tasks.moveUp(task))}
          aria-label="Move up"
          className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={pending || isLast}
          onClick={run(() => tasks.moveDown(task))}
          aria-label="Move down"
          className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
        >
          ↓
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={run(() => tasks.remove(task))}
          aria-label="Remove"
          className="rounded px-1.5 py-0.5 text-red-400 hover:bg-red-50"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
