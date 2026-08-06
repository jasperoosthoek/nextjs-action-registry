import * as notes from '@/app/actions/notes';
import { NewNote } from './new-note';
import { NoteRow } from './note-row';

export default async function NotesPage() {
  const items = await notes.list();

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold">
        Notes <span className="font-normal text-slate-400">({items.length})</span>
      </h1>
      <NewNote />
      <ul className="mt-6 space-y-3">
        {items.map((n) => (
          <NoteRow key={n.id} note={n} />
        ))}
      </ul>
      {items.length === 0 && <p className="mt-6 text-sm text-slate-500">No notes yet — add one above.</p>}
    </main>
  );
}
