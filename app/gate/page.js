import { safeNext } from '../../lib/safe-next';
import GateScreen from './client';

/**
 * The screen you type the password into.
 *
 * It is deliberately outside the game's own stylesheets — a stylesheet served through the same gate
 * cannot style the page that opens the gate — so everything it needs is inline, including the two
 * fonts, and it works before any cookie exists.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
    title: 'Private — Dungeon Knights',
    // Belt and braces with the middleware's `X-Robots-Tag`: this page should never be indexed either.
    robots: { index: false, follow: false },
};

export default function GatePage({ searchParams }) {
    // Sanitised on the server *and* used only as a client-side navigation target, so a crafted
    // `?next=` cannot turn this into an open redirect.
    const next = safeNext(typeof searchParams?.next === 'string' ? searchParams.next : '/');
    return <GateScreen next={next} />;
}
