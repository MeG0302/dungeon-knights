/**
 * The screenshots on `/genesis`, and the rule that nothing on that page pretends to be one.
 *
 * The page asks for captures of the real game. There was no honest way to fill those frames before
 * they exist: an illustration in a frame captioned "screenshot" is a claim about the build that the
 * build has not earned, and it is the one thing a page selling a collection must not do. So the
 * frames are **driven by the folder**: a slot renders its picture and its caption only when a file
 * of that name is actually sitting in `public/assets/genesis/`, and until then it says, in the
 * frame, that the capture is still to come.
 *
 * That makes adding one a file copy rather than a code change — and it makes the empty state
 * testable, which is why `readShots` takes its directory as an argument: the harness passes a
 * fixture directory and asserts both answers (a file present fills the slot, a file absent does
 * not) without touching the served folder.
 *
 * Reader only — server-side. It uses `fs`, so it must never be imported by a client component.
 */

import { promises as fs } from 'fs';
import path from 'path';

/**
 * The pictures a slot will accept, in the order they are preferred.
 *
 * `.webp` first because a capture should be small — these are photographs of a running game at
 * panel size, and a 2 MB PNG in a frame that renders 300px wide is a slow page for no visible gain.
 * The rest are accepted so that dropping in whatever the capture tool produced works.
 */
export const SHOT_EXTENSIONS = ['.webp', '.jpg', '.jpeg', '.png'];

/** Where the captures are dropped. Served from `/assets/genesis/`, which the middleware passes. */
export function defaultShotDir() {
    return path.join(process.cwd(), 'public', 'assets', 'genesis');
}

/**
 * The three slots, each naming the picture it is waiting for.
 *
 * The keys are file names (`dungeon-run.webp` fills `dungeon-run`), and each caption says what the
 * picture actually shows — so a filled slot reads as evidence rather than decoration, and an empty
 * one is a specific promise about a specific capture.
 */
export const SHOT_SLOTS = [
    {
        // A knight squad, not a Genesis one. The capture is of the summonable collection mid-run —
        // and since the two collections are the whole subject of this page, a caption that named
        // the wrong side would be the one mistake a buyer would never catch and never forgive.
        key: 'dungeon-run',
        caption: 'A knight squad mid-run',
        detail: 'Knights deployed into a themed dungeon, with the damage numbers up.',
    },
    {
        key: 'staking-vault',
        caption: 'Staked in the vault',
        detail: 'A Genesis knight staked, with its tickets and its pool share accruing.',
    },
    {
        // The draw's prize, and the room it is spent in. The slot was called `weekly-draw` and
        // described a capsule won last week — but the capture that fills it is the Summoning
        // Chamber, because a capsule has no picture of its own: it is a thing you open. A caption
        // describing a screen the frame does not show is the failure this whole file exists to
        // prevent, so the slot is named for the picture rather than the picture being stretched to
        // fit the name.
        key: 'capsules',
        caption: 'Capsules in the Summoning Chamber',
        detail: 'Where a capsule the draw awarded is opened, and a Knight is revealed.',
    },
];

/**
 * One entry per slot, in the order they are drawn.
 *
 * Returns `{ key, caption, detail, src, file }` — `src` is the served URL or `null`, and `file` is
 * the name found (so the page can print it, and the harness can assert on the match rather than on
 * its own optimism). A missing directory is `null` for every slot, not a throw: the folder may
 * simply not exist yet, and that is the state the page is designed to render.
 */
export async function readShots(dir = defaultShotDir()) {
    let names = [];
    try {
        names = await fs.readdir(dir);
    } catch {
        names = [];
    }

    // Case-insensitive, because these names are typed by hand on a Windows laptop and `Windows`
    // is the only host where `Dungeon-Run.WEBP` still resolves. Matching on the lowercased name
    // keeps the served path inside `public/` while letting the file be named however it was saved.
    const byLower = new Map(names.map((name) => [name.toLowerCase(), name]));

    return SHOT_SLOTS.map((slot) => {
        const found = SHOT_EXTENSIONS
            .map((ext) => byLower.get(`${slot.key}${ext}`))
            .find(Boolean) || null;
        return {
            ...slot,
            file: found,
            src: found ? `/assets/genesis/${found}` : null,
        };
    });
}
