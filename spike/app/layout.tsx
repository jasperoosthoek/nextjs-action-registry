import './globals.css';
import Link from 'next/link';
import { getCurrentUserId } from './_lib/user';
import { UserSwitcher } from './_components/user-switcher';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const userId = await getCurrentUserId();

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
            <nav className="flex gap-4 text-sm font-medium text-slate-600">
              <Link href="/" className="hover:text-indigo-600">
                Tasks
              </Link>
              <Link href="/notes" className="hover:text-indigo-600">
                Notes
              </Link>
              <Link href="/lists" className="hover:text-indigo-600">
                Lists
              </Link>
            </nav>
            <UserSwitcher current={userId} />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
