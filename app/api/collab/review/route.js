import { NextResponse } from 'next/server';
import {
    REQUEST_LIMITS,
    listRequests,
    normaliseAddress,
    normaliseNote,
    reviewRow,
    setRequestStatus,
    storageDescription,
} from '../../../../lib/collab-store.js';
import { isOwner, ownerCount } from '../../../../lib/collab-owners.js';
import { sessionFromRequest } from '../../../../lib/points-session.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The owner's half of the collab requests, for the page at `/collab/review`.
 *
 * Two verbs, and the authorization is the whole of what makes them safe:
 *
 *   - **The wallet in the body is the subject, not the credential.** This is the opposite of
 *     `/api/collab`, which files an entry for whoever signed and therefore reads the address out of
 *     the session and ignores the body entirely. Here the *subject* is somebody else's request — so
 *     `wallet` comes from the body, and the authority comes from the session, which must be the
 *     signed wallet of an address on `COLLAB_OWNERS`. Neither half can stand in for the other.
 *   - **A signed-in stranger gets a 403 and no rows.** The list is a project's plan, its handle and
 *     the wallet that sent it. It is readable by the owner and by nobody else, and the refusal says
 *     how many owners are configured, because an unset `COLLAB_OWNERS` is the one failure that would
 *     otherwise look exactly like a wrong wallet.
 *
 * It also **cannot do more than decide**. There is no edit here, no way to set a field on a request,
 * no way to remove one (`--remove` is the CLI's, deliberately: a browser button that deletes somebody's
 * request is a button worth not building) and no way to change who is an owner. It moves a status, and
 * only between the two decisions a person makes.
 *
 * No throttling, on purpose: `countAttempt` exists to keep a **public** endpoint from being looped by
 * strangers, and this one cannot be reached by a stranger at all. A rate limit here would only ever be
 * felt by the owner working through a backlog.
 */

/** The two decisions there are. `pending` is not one of them — nobody un-decides a request from here. */
const DECISIONS = ['approved', 'rejected'];

/** The subject wallet, from the body. */
function subject(value) {
    return normaliseAddress(value);
}

/** Is the caller the owner? `{ address }` or `{ error }` with the response already built. */
function owner(request) {
    const address = sessionFromRequest(request);
    if (!address) {
        return {
            error: NextResponse.json(
                { error: 'Connect the owner wallet and sign in first.', code: 'signed-out' },
                { status: 401 }
            ),
        };
    }
    if (!isOwner(address)) {
        return {
            error: NextResponse.json(
                {
                    error: 'That wallet is not on this deployment\'s collab owner list.',
                    code: 'not-an-owner',
                    // Not the list itself, just whether there is one: an empty `COLLAB_OWNERS` and a
                    // wallet that is simply not on it look the same from the outside otherwise, and
                    // the first one is a one-line fix by whoever is looking at this.
                    owners: ownerCount(),
                },
                { status: 403 }
            ),
        };
    }
    return { address };
}

/** How many rows are in each state — the owner's own view, and never a public page's. */
function counts(rows) {
    return {
        pending: rows.filter((row) => row.status === 'pending').length,
        approved: rows.filter((row) => row.status === 'approved').length,
        rejected: rows.filter((row) => row.status === 'rejected').length,
    };
}

/** Every request, oldest first, without the picture's bytes. */
export async function GET(request) {
    const { error } = owner(request);
    if (error) return error;

    try {
        const rows = await listRequests();
        return NextResponse.json({
            ok: true,
            owners: ownerCount(),
            counts: counts(rows),
            requests: rows.map(reviewRow),
            storage: storageDescription(),
        });
    } catch (err) {
        return NextResponse.json(
            {
                error: 'The requests could not be read just now. Please try again in a moment.',
                code: 'store-unavailable',
                detail: process.env.NODE_ENV === 'production' ? undefined : String(err?.message || err),
            },
            { status: 503 }
        );
    }
}

/** Approve or reject one request. Nothing else about it is writable here. */
export async function POST(request) {
    const { error } = owner(request);
    if (error) return error;

    let body = {};
    try {
        body = await request.json();
    } catch {
        // Treated as an empty decision below rather than a crash.
    }

    const wallet = subject(body?.wallet);
    if (!wallet) {
        return NextResponse.json({ error: 'Say which request — a 0x wallet address.', code: 'bad-wallet' }, { status: 400 });
    }

    const status = body?.status;
    if (!DECISIONS.includes(status)) {
        return NextResponse.json(
            { error: `A decision is one of: ${DECISIONS.join(', ')}.`, code: 'bad-status' },
            { status: 400 }
        );
    }

    // Normalised here as well as clipped in the store, because this one ends up on a page the project
    // reads: a note that is one line of whitespace is not a note, and one longer than the limit is a
    // refusal rather than a silent truncation of something somebody meant to say.
    const raw = body?.note;
    const note = raw === undefined || raw === null || raw === '' ? null : normaliseNote(raw);
    if (raw !== undefined && raw !== null && raw !== '' && !note) {
        return NextResponse.json(
            { error: `A note of ${REQUEST_LIMITS.note} characters or fewer, on one line.`, code: 'bad-note' },
            { status: 400 }
        );
    }

    try {
        const result = await setRequestStatus(wallet, status, { note });
        if (result.error) {
            return NextResponse.json(
                { error: result.error, code: result.code },
                { status: result.code === 'not-found' ? 404 : 400 }
            );
        }

        const rows = await listRequests();
        return NextResponse.json({
            ok: true,
            request: reviewRow(result.request),
            counts: counts(rows),
        });
    } catch (err) {
        return NextResponse.json(
            {
                error: 'That decision could not be saved just now. Please try again in a moment.',
                code: 'store-unavailable',
                detail: process.env.NODE_ENV === 'production' ? undefined : String(err?.message || err),
            },
            { status: 503 }
        );
    }
}
