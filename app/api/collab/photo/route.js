import { NextResponse } from 'next/server';
import { approvedRequestForSlug, readPhotoDataUrl } from '../../../../lib/collab-store.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The profile picture of a project that was approved through `/collab#submit`.
 *
 * A pinned project's picture is a file in `public/` and the browser fetches it from the CDN. An
 * approved project's picture is not a file: the store holds it as a `data:` URL on the request, and
 * this route is the thing that turns that back into an image with a content type and an etag. It
 * exists so the tab does not have to care where a picture came from — `avatar` is a URL either way.
 *
 * Three decisions, all of them about it being a **public** route that serves bytes somebody uploaded:
 *
 *   - **Only an approved project has one.** The lookup is `approvedRequestForSlug`, which reads the
 *     approved rows: a pending or rejected request's picture is not served, and neither is one for a
 *     project that does not exist. Approval is the whole of what publishes it, and a slug with no
 *     approved row behind it is a 404 with no picture in it — the same answer as a project that has
 *     not uploaded one yet, which is the honest one for both.
 *   - **The bytes are re-checked, not trusted.** They were checked when they were uploaded, and they
 *     are checked again here against the declared type, because this is where they are handed to a
 *     browser to execute as an image. A stored row that says `image/svg+xml` — or says `image/png`
 *     and is not one — is a 404, not a response with a wrong content type.
 *   - **It is cached hard, because the URL carries the version.** `lib/collab-content.js` puts the
 *     upload time in the query, so a replaced picture is a different address. That is what makes
 *     `immutable` honest here rather than a stale face on somebody's giveaway.
 *
 * Nothing is logged and nothing is counted: this is a picture on a public page, asked for by every
 * visitor's browser, and there is no address or identity attached to the request to record.
 */

export async function GET(request) {
    const project = new URL(request.url).searchParams.get('project');

    let stored = null;
    try {
        stored = await approvedRequestForSlug(project);
    } catch (error) {
        // A store that is down is a missing picture, not a broken page: the tab already has a
        // fallback for a project with no picture, and a 503 here would draw the browser's own
        // broken-image glyph over a project that has a perfectly good one.
        return NextResponse.json(
            {
                error: 'That picture could not be read just now.',
                code: 'store-unavailable',
                detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error),
            },
            { status: 503 }
        );
    }

    const read = readPhotoDataUrl(stored?.photo);
    if (!read.ok) {
        // No picture yet, or one that no longer passes the check it passed on the way in.
        return NextResponse.json({ error: 'That project has no picture yet.', code: 'no-photo' }, { status: 404 });
    }

    return new NextResponse(read.buffer, {
        status: 200,
        headers: {
            'Content-Type': read.mime,
            // The upload time is in the URL, so this one can be kept for as long as a browser likes.
            'Cache-Control': 'public, max-age=31536000, immutable',
            // Belt and braces: the bytes are a PNG, JPEG or WebP by their own magic number, and this
            // stops a browser deciding they are something else on the way out.
            'X-Content-Type-Options': 'nosniff',
        },
    });
}
