import { NextResponse } from 'next/server';
import {
    countAttempt,
    getRegistration,
    knownProject,
    registerForProject,
    registrationCount,
    storageDescription,
} from '../../../lib/collab-store.js';
import { sessionFromRequest } from '../../../lib/points-session.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Collab giveaway registration.
 *
 * Two facts make this route what it is:
 *
 *   - **The address is never taken from the request body.** It comes out of the signed session
 *     (`Authorization: Bearer …`, the Points Program's own token), so an entry cannot be filed for a
 *     wallet nobody controls. `registerForProject` accepts an address because it is a store; proving
 *     it is this route's job and this is where it happens.
 *   - **It answers one project at a time.** `project` is required on both verbs and checked against
 *     the store's own answer, `knownProject`: a pinned project, or one whose request has been
 *     approved. A typo cannot create a new giveaway namespace, and neither can a browser — there is
 *     no verb here that approves anything.
 *
 * `GET` is public and takes `?project=<slug>`: it answers how many wallets are registered — for the
 * tools, and so a signed-in visitor can be told on reload that they are already in. Nothing personal
 * is exposed: a registration is a public wallet address and this route never returns one.
 */

/** Behind Vercel there is always a proxy; the first hop is the client. */
function clientIp(request) {
    const forwarded = request.headers.get('x-forwarded-for') || '';
    const first = forwarded.split(',')[0].trim();
    return first || request.headers.get('x-real-ip') || 'unknown';
}

export async function GET(request) {
    const project = new URL(request.url).searchParams.get('project');
    if (!(await knownProject(project))) {
        return NextResponse.json({ error: 'Pick a project from the collab giveaway.', code: 'unknown-project' }, { status: 400 });
    }

    const address = sessionFromRequest(request);
    const existing = address ? await getRegistration(project, address) : null;

    return NextResponse.json({
        ok: true,
        project,
        count: await registrationCount(project),
        // `registered` is about *this wallet*, and it is answered from the store rather than from the
        // browser: a page that trusts `localStorage` would tell somebody who cleared their data that
        // they were never in, and tell the next person to use this device that they are.
        registered: existing !== null,
        position: existing?.position ?? null,
        storage: storageDescription(),
    });
}

export async function POST(request) {
    const address = sessionFromRequest(request);
    if (!address) {
        return NextResponse.json(
            { error: 'Connect a wallet and sign in before registering.', code: 'signed-out' },
            { status: 401 }
        );
    }

    let body = {};
    try {
        body = await request.json();
    } catch {
        // Treated as an empty submission below rather than a crash.
    }

    const project = body?.project;
    const known = await knownProject(project);
    if (!known) {
        return NextResponse.json({ error: 'Pick a project from the collab giveaway.', code: 'unknown-project' }, { status: 400 });
    }

    const attempt = await countAttempt(clientIp(request));
    if (!attempt.allowed) {
        return NextResponse.json(
            { error: 'Too many attempts from this connection — give it a minute.', code: 'throttled' },
            { status: 429 }
        );
    }

    try {
        const result = await registerForProject({
            slug: project,
            address,
            handle: body?.handle ?? null,
            source: typeof body?.source === 'string' ? body.source : 'collab',
        });

        if (result.error) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
        }

        return NextResponse.json({
            ok: true,
            project,
            alreadyRegistered: result.alreadyRegistered === true,
            position: result.position,
            count: await registrationCount(project),
            storage: storageDescription(),
            // Named rather than implied, like the waitlist's, so whoever is reading a response while
            // testing can see where the entry went without guessing which deployment is configured.
            name: known.name || project,
        });
    } catch (error) {
        // A store that is unreachable is not the visitor's problem, and saying "try again" is honest:
        // nothing was recorded.
        return NextResponse.json(
            {
                error: 'That registration could not be saved just now. Please try again in a moment.',
                code: 'store-unavailable',
                detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error),
            },
            { status: 503 }
        );
    }
}
