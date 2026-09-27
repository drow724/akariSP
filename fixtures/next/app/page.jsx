import Link from 'next/link';
import Toggle from './toggle.jsx';

// Server component: renders the client-side owner through a client toggle.
export default function Page() {
  return (
    <main>
      <Toggle />
      <Link id="to-other" href="/other">other</Link>
    </main>
  );
}
