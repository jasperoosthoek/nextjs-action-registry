import { direct, viaProperty } from './actions';

// Each action is wired to a <form action={...}> so it can't be tree-shaken and MUST be
// registered as a server reference for the build to succeed.
export default function Page() {
  return (
    <main>
      <h1>Server-action registration spike</h1>
      <form action={direct}>
        <input name="x" />
        <button type="submit">Form 1: HOF direct</button>
      </form>
      <form action={viaProperty}>
        <input name="x" />
        <button type="submit">Form 3: property assignment</button>
      </form>
    </main>
  );
}
