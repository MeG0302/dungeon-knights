#!/usr/bin/env node
/**
 * Do owner-published one-time tasks behave — in the store, in the tab, and in the payout?
 *
 *     node tools/check-one-time.js [http://localhost:3000]
 *
 * The feature is small; the ways it can go wrong are not. A task added twice must not become two
 * cards paying the same reward. A task that has been paid must leave the tab **and still refuse a
 * second payout** — hiding is presentation, and if it were the rule, reloading the page would be a
 * way to earn again. A stored document somebody edited by hand must not break the tab for everyone.
 * And the claim path must stay blind to these tasks, or a checked task could be paid on a tap with
 * its verifier bypassed entirely.
 *
 * The waitlist task is the other extreme and gets the same treatment: it has **nothing** behind it,
 * so the rules pinned here are that it pays on the claim itself, prices nothing twice, and says in
 * as many words that nothing was checked.
 *
 * So this checks the rules three ways: the link parser and the store document directly, the *tab*
 * through the real API on a running server, and the payout through the same endpoints a page uses.
 * Without a URL argument the live half is skipped and the offline half still runs.
 *
 * **It restores what it found.** The task document and the wallet it creates are put back exactly as
 * they were, so running this against a checkout with real tasks published leaves those tasks alone.
 */

import crypto from 'node:crypto';
import { addExtraTask, extraOneTimeTasks, parsePostUrl, removeExtraTask } from '../lib/points-tasks.js';
import { ONE_TIME_TASKS, oneTimeTask } from '../lib/points-config.js';
import {
    documentRead, documentWrite, purgeWallet, updateWallet, getWallet, STORAGE_DRIVER, storageDescription,
} from '../lib/points-store.js';

const BASE = process.argv[2] || null;
const TASKS_KEY = 'dk:points:tasks';

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

async function api(path, { method = 'GET', body, token } = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = {};
    }
    return { status: res.status, data };
}

/** A post that certainly is not real, so a test task can never collide with a published one. */
const TEST_POST = 'https://x.com/DNGunittest/status/9876543210987654321';

/** The tweet id behind a shipped card, which is also its id in the store. */
function shippedPostId(card) {
    return parsePostUrl(card.url).id;
}

(async () => {
    console.log('');
    console.log(`One-time tasks — ${storageDescription()}`);
    if (STORAGE_DRIVER === 'memory') {
        console.log('  note: the memory driver cannot be shared between processes;');
        console.log('        run this where the store is a file (development) or KV (production).');
    }

    const before = await documentRead(TASKS_KEY);
    const created = [];

    try {
        // ------------------------------------------------------------------ the parser
        console.log('');
        console.log('A link that is a post, and nothing else');

        const good = [
            'https://x.com/DNGrobinhood/status/2101382088767517039',
            'https://twitter.com/DNGrobinhood/status/2101382088767517039?s=20',
            'https://www.x.com/DNGrobinhood/status/2101382088767517039/photo/1',
            'x.com/DNGrobinhood/status/2101382088767517039',
        ];
        const parsed = good.map(parsePostUrl);
        rec('post links are accepted, tracking and all', parsed.every(Boolean),
            parsed.filter(Boolean).map((p) => p.id).join(', ') || 'none parsed');
        rec('  … and every one of them lands on the same post id',
            new Set(parsed.filter(Boolean).map((p) => p.id)).size === 1,
            String(parsed.find(Boolean)?.id));
        rec('  … and the stored form drops the tracking',
            parsed[1]?.url === 'https://x.com/DNGrobinhood/status/2101382088767517039', parsed[1]?.url);

        const bad = [
            'https://x.com/DNGrobinhood',                          // a profile
            'https://t.co/OqLZ1Yq7Zm',                             // a shortener
            'https://example.com/DNGrobinhood/status/2101382088767517039',
            'https://x.com/DNGrobinhood/status/12',                // not an id
            'https://x.com/DNGrobinhood/status/abcdefghijklmnop',
            '',
        ];
        rec('and everything else is refused', bad.every((link) => parsePostUrl(link) === null),
            bad.map((link) => `${link || '(empty)'}→${parsePostUrl(link) ? 'parsed' : 'refused'}`).join(' · '));

        // ------------------------------------------------------------------ publishing
        console.log('');
        console.log('Publishing');

        const first = await addExtraTask({ url: TEST_POST, kind: 'comment' });
        if (first.ok) created.push(first.task.id);
        rec('a post becomes a task', first.ok === true, first.ok ? first.task.kind : first.error);
        rec('  … identified by the post, with the ask named',
            first.task?.id === '9876543210987654321' && first.task.ask === 'comment'
            && first.task.proof === 'verify' && first.task.reward > 0,
            `${first.task?.id} · ${first.task?.ask} · ${first.task?.proof} · ${first.task?.reward} PTS`);
        // The card is an ask, not a description of our plumbing: one sentence naming what to post and
        // the tag. A caveat about the check belongs in the module, not under a task a player is trying
        // to finish — and a word the card should never say is the cheapest way to catch one creeping
        // back in through a stored task's own `hint`.
        rec('  … and its hint is the ask itself, in one sentence, with no caveat under it',
            /tag @\{handle\}/.test(first.task?.hint || '')
            && !/cannot see|no check|on your word|verified/i.test(first.task?.hint || '')
            && first.task?.hint.split('.').filter(Boolean).length <= 2,
            (first.task?.hint || '').slice(0, 62) + '…');

        const again = await addExtraTask({ url: `${TEST_POST}?s=20`, kind: 'comment' });
        const stored = await extraOneTimeTasks();
        rec('adding the same post twice updates one task instead of making two',
            again.ok === true && again.replaced === true
            && stored.filter((task) => task.id === first.task.id).length === 1,
            `replaced=${again.replaced} · ${stored.filter((task) => task.id === first.task.id).length} card(s)`);

        const changed = await addExtraTask({ url: TEST_POST, kind: 'quote', reward: 750 });
        rec('the ask and the reward can be changed on that same task',
            changed.task?.ask === 'quote' && changed.task?.reward === 750
            && (await extraOneTimeTasks()).length === stored.length,
            `${changed.task?.ask} · ${changed.task?.reward} PTS`);

        const wrongKind = await addExtraTask({ url: TEST_POST, kind: 'like' });
        const badReward = await addExtraTask({ url: TEST_POST, reward: 'soon' });
        const zeroReward = await addExtraTask({ url: TEST_POST, reward: 0 });
        const notPost = await addExtraTask({ url: 'https://x.com/DNGrobinhood' });
        rec('an unknown ask, a nonsense reward and a profile link are all refused, by code',
            wrongKind.code === 'unknown-kind' && badReward.code === 'bad-reward'
            && zeroReward.code === 'bad-reward' && notPost.code === 'not-a-post',
            [wrongKind.code, badReward.code, zeroReward.code, notPost.code].join(' · '));

        // One post carries one task. The engine refuses to pay two tasks for the same link, so a
        // second card could never settle — refusing it here is the difference between a message the
        // owner can act on and a card a player did the work on before being turned away.
        const shipped = ONE_TIME_TASKS.find((task) => task.proof === 'verify');
        const beforeClash = (await extraOneTimeTasks()).length;
        const clash = await addExtraTask({ url: shipped.url, kind: 'comment' });
        rec('a post the program already has a card for is refused, naming that card',
            clash.code === 'already-shipped' && clash.taskId === shipped.id
            && (await extraOneTimeTasks()).length === beforeClash,
            `${clash.code} · ${clash.taskId} · nothing stored`);

        // The escape hatch, and the reason the refusal is not unconditional: a store can already hold
        // a task for a shipped post — a document written before this rule existed, or edited by hand —
        // and an *update* to it is still one card. Refusing that would leave the duplicate unfixable
        // except by removing it first.
        const shippedId = shippedPostId(shipped);
        await documentWrite(TASKS_KEY, JSON.stringify([
            ...(await extraOneTimeTasks()).filter((task) => task.id !== shippedId),
            { id: shippedId, url: shipped.url, ask: 'comment', reward: 500 },
        ]));
        const patch = await addExtraTask({ url: shipped.url, reward: 640 });
        rec('  … and a store that already holds one can still be corrected, not wedged',
            patch.ok === true && patch.task?.reward === 640,
            patch.ok ? `${patch.task.reward} PTS · ${patch.replaced ? 'updated' : 'stored'}` : patch.error);
        await removeExtraTask(shipped.url);

        // ------------------------------------------------------- a document edited by hand
        console.log('');
        console.log('A document from outside the tool');

        await documentWrite(TASKS_KEY, JSON.stringify([
            { id: '111111111111111111', url: 'https://x.com/DNGrobinhood/status/111111111111111111', reward: 'x', ask: 'nonsense', title: '' },
            { id: '222222222222222222', url: 'https://x.com/DNGrobinhood/status/222222222222222222' },
            { id: '222222222222222222', url: 'https://x.com/DNGrobinhood/status/222222222222222222' },
            { id: '333333333333333333', url: 'https://example.com/not-a-post' },
            'not an object',
            null,
        ]));
        const salvaged = await extraOneTimeTasks();
        rec('a hand-edited document still renders, and never invents a reward',
            salvaged.length === 2 && salvaged.every((task) => Number.isFinite(task.reward) && task.reward > 0),
            salvaged.map((task) => `${task.id}:${task.reward}`).join(' · '));
        rec('  … duplicates collapse, junk entries are dropped, and a bad link takes its card with it',
            new Set(salvaged.map((task) => task.id)).size === 2
            && !salvaged.some((task) => task.id === '333333333333333333'),
            salvaged.map((task) => task.id).join(' · '));
        rec('  … and a card with no fields gets the ask\'s own copy rather than a blank one',
            /tag @\{handle\}/.test(salvaged[0].hint) && salvaged[0].title.length > 0 && salvaged[0].cta.length > 0,
            `${salvaged[0].title} · ${salvaged[0].cta}`);

        await documentWrite(TASKS_KEY, JSON.stringify([changed.task]));

        const removedByLink = await removeExtraTask(TEST_POST);
        rec('a task comes down by its link', removedByLink.ok === true && removedByLink.remaining === 0,
            `removed ${removedByLink.removed}`);
        const reAdded = await addExtraTask({ url: TEST_POST, kind: 'comment' });
        const removedById = await removeExtraTask(reAdded.task.kind);
        const missing = await removeExtraTask('999999999999999999');
        rec('  … and by its id, including the kind the page sends back',
            removedById.ok === true && missing.code === 'not-found',
            `id removed=${removedById.ok} · absent=${missing.code}`);
        created.length = 0;

        // ------------------------------------------- a task nothing checks, and says so
        console.log('');
        console.log('The waitlist task: no verifier behind it, and the card admits it');

        // It is the only one-time task with nothing behind it — no post for X to be asked about and
        // no review window — so what is worth pinning is that its own copy says that, and that it is
        // a **different kind** from the follow. Reusing `claim` would hand it the follow's proof
        // mode, and the day this deployment is wired to X's follow webhook it would start demanding a
        // follow event for something that has nothing to do with following.
        const waited = ONE_TIME_TASKS.filter((task) => task.proof === 'visit');
        rec('the waitlist is a task of its own kind, not a claim wearing the follow’s proof',
            waited.length === 1 && waited[0].id === 'waitlist',
            waited.map((task) => `${task.id}:${task.proof}`).join(', ') || '(none)');
        rec('  … it sends the player to our own waitlist page, not to X',
            Boolean(waited[0]?.url?.endsWith('/genesis')) && !/x\.com|twitter\.com/.test(waited[0]?.url || ''),
            waited[0]?.url);
        rec('  … it promises no review window, and keeps one sentence because there is one truth',
            !waited[0]?.review && !waited[0]?.blurbChecked && Number.isInteger(waited[0]?.reward) && waited[0].reward > 0
            && /no check/i.test(waited[0]?.blurb || '')
            && !/review|30\u201345 minutes|X tells/i.test(waited[0]?.blurb || ''),
            (waited[0]?.blurb || '').slice(0, 72) + '…');
        // The claim endpoint reads this registry and nothing else, so a task it cannot find is a card
        // that refuses to pay; and a `kind` on it would let the post endpoint try to settle it, which
        // is the one door a task with no post must not have.
        rec('  … and the claim path can find it, with no post kind to be settled by',
            Boolean(oneTimeTask('waitlist')) && !waited[0]?.kind,
            `lookup=${Boolean(oneTimeTask('waitlist'))} kind=${waited[0]?.kind || 'none'}`);

        // ------------------------------------------------------------------ the live half
        if (!BASE) {
            console.log('');
            console.log('(no server URL given — the tab and the payout are checked in the next run)');
        } else {
            console.log('');
            console.log(`The tab, and the payout — ${BASE}`);

            const live = await addExtraTask({ url: TEST_POST, kind: 'comment', reward: 640 });
            created.push(live.task.id);

            // The route's own default, which is not the library's. A bare call has to come back with
            // the board the page asks for — the two are compared rather than counted, so this says
            // something on a store of any size: it catches the default being *ignored* (an absent
            // `?limit` becoming `Number(null)` = 0, which is finite) rather than a store being small.
            const bareBoard = (await api('/api/points/leaderboard')).data?.rows?.length;
            const askedBoard = (await api('/api/points/leaderboard?limit=10')).data?.rows?.length;
            rec('a board call with no limit is served what the page asks for, not one row',
                bareBoard === askedBoard && bareBoard > 0,
                `${bareBoard} by default · ${askedBoard} when asked for 10`);

            const session = await import('../lib/points-session.js');
            const address = `0x${crypto.randomBytes(20).toString('hex')}`;
            const token = session.issueToken(address).token;

            const started = await api(`/api/points/session?address=${address}`);
            const bind = await api('/api/points/x', {
                method: 'POST', token, body: { action: 'bind', identity: { username: `onetest${crypto.randomBytes(3).toString('hex')}` } },
            });
            rec('a wallet can be set up to look at the tab',
                started.status === 200 && bind.status === 200, `${started.status}/${bind.status}`);

            const seen = (await api('/api/points/me', { token })).data?.state?.oneTime || [];
            const card = seen.find((task) => task.id === live.task.id);
            rec('a published task is in that wallet\'s tab', Boolean(card),
                seen.map((task) => task.id).join(', ') || '(nothing)');
            rec('  … as a checked task, with the reward and the post it opens',
                card?.proof === 'verify' && card?.reward === 640 && card?.kind === `onetime:${live.task.id}`
                && card?.postUrl === TEST_POST,
                `${card?.proof} · ${card?.reward} PTS · ${card?.postUrl}`);

            // Paid, then looked at again — the state this feature exists for.
            // What the real payout leaves behind: the reward on the balance *and* the record that
            // says which task it was for. Written in one update, because that is how `settle` writes
            // it — a fixture with the record but not the points would be a wallet that cannot exist.
            const doc = await getWallet(address);
            await updateWallet(address, (w) => {
                w.points = (w.points || 0) + 640;
                w.tasks = {
                    ...(w.tasks || {}),
                    [`one:${live.task.id}`]: {
                        state: 'verified', credited: 640, verifiedAt: new Date().toISOString(),
                        url: `https://x.com/${doc.x.username}/status/1234567890123456789`,
                    },
                };
                return w;
            });

            const after = (await api('/api/points/me', { token })).data?.state?.oneTime || [];
            rec('and it leaves that player\'s tab once it has been paid',
                !after.some((task) => task.id === live.task.id),
                after.map((task) => task.id).join(', ') || '(nothing)');
            rec('  … while the follow stays, so a missing card never reads as a bug',
                after.some((task) => task.id === 'follow'), after.map((task) => task.id).join(', '));
            rec('  … and the points it paid are still on the wallet',
                (await api('/api/points/me', { token })).data?.state?.points === 640,
                `${(await api('/api/points/me', { token })).data?.state?.points} PTS`);

            // Hiding is the tab's business only: the rules behind it are untouched.
            const claim = await api('/api/points/task', {
                method: 'POST', token, body: { action: 'claim', task: `onetime:${live.task.id}` },
            });
            rec('a checked task can never be paid on a tap, hidden or not',
                claim.status === 400 && claim.data?.code === 'unknown-task',
                `${claim.status} ${claim.data?.code}`);

            const resubmit = await api('/api/points/task', {
                method: 'POST', token, body: { action: 'submit', task: `onetime:${live.task.id}`, url: 'https://x.com/DNGunittest/status/1234567890123456789' },
            });
            rec('  … and filing it again pays nothing',
                resubmit.status === 200 && resubmit.data?.alreadyCredited === true && !resubmit.data?.credited,
                `${resubmit.status} alreadyCredited=${resubmit.data?.alreadyCredited}`);

            await purgeWallet(address);
            const gone = await getWallet(address);
            rec('the test wallet is cleaned up', gone === null, gone ? 'still present' : 'purged');
            created.length = 0;

            // ------------------------------------------------- the waitlist, paid end to end
            // Its own wallet, so nothing here can disturb the balance the section above pinned.
            console.log('');
            console.log('A task that pays on the claim itself');

            const waiter = `0x${crypto.randomBytes(20).toString('hex')}`;
            const waiterToken = session.issueToken(waiter).token;
            await api(`/api/points/session?address=${waiter}`);
            await api('/api/points/x', {
                method: 'POST',
                token: waiterToken,
                body: { action: 'bind', identity: { username: `wait${crypto.randomBytes(3).toString('hex')}` } },
            });

            const waiterCard = ((await api('/api/points/me', { token: waiterToken })).data?.state?.oneTime || [])
                .find((task) => task.id === 'waitlist');
            rec('a wallet sees the waitlist card, with the page it opens and no window on it',
                Boolean(waiterCard) && waiterCard.proof === 'visit' && waiterCard.claimed === false
                && /\/genesis$/.test(waiterCard.url || '') && waiterCard.reward > 0 && !waiterCard.settleAt,
                `${waiterCard?.proof} · ${waiterCard?.url} · ${waiterCard?.reward} PTS`);

            const paidWait = await api('/api/points/task', {
                method: 'POST', token: waiterToken, body: { action: 'claim', task: 'waitlist' },
            });
            rec('  … and claiming it pays in that same call, with nothing pending',
                paidWait.status === 200 && paidWait.data?.credited === waiterCard?.reward && !paidWait.data?.pending,
                `${paidWait.status} · ${paidWait.data?.credited} PTS · pending=${paidWait.data?.pending}`);
            rec('  … and the balance is exactly that, so it paid once and once only',
                (await api('/api/points/me', { token: waiterToken })).data?.state?.points === waiterCard?.reward,
                `${(await api('/api/points/me', { token: waiterToken })).data?.state?.points} PTS`);

            const receiptView = ((await api('/api/points/me', { token: waiterToken })).data?.state?.oneTime || [])
                .find((task) => task.id === 'waitlist');
            rec('  … and the card stays as a receipt that says nothing was checked',
                Boolean(receiptView) && receiptView.claimed === true
                && /nothing was checked/i.test(receiptView.claimedNote || ''),
                receiptView?.claimedNote);

            const againWait = await api('/api/points/task', {
                method: 'POST', token: waiterToken, body: { action: 'claim', task: 'waitlist' },
            });
            rec('  … and a second tap pays nothing more',
                againWait.status === 200 && againWait.data?.alreadyCredited === true && !againWait.data?.credited,
                `${againWait.status} · alreadyCredited=${againWait.data?.alreadyCredited}`);

            // The identity behind it, which is the only thing holding a task with no check down:
            // a binding is permanent and one-per-handle, so the cheapest way to farm this is still a
            // real X account.
            const unbound = `0x${crypto.randomBytes(20).toString('hex')}`;
            const unboundToken = session.issueToken(unbound).token;
            await api(`/api/points/session?address=${unbound}`);
            const refusedWait = await api('/api/points/task', {
                method: 'POST', token: unboundToken, body: { action: 'claim', task: 'waitlist' },
            });
            rec('  … and a wallet with no X account cannot claim it at all',
                refusedWait.status === 403 && refusedWait.data?.code === 'x-required',
                `${refusedWait.status} ${refusedWait.data?.code}`);

            await purgeWallet(waiter);
            await purgeWallet(unbound);
            const waiterGone = (await getWallet(waiter)) === null && (await getWallet(unbound)) === null;
            rec('the waitlist test wallets are cleaned up', waiterGone, waiterGone ? 'purged' : 'still present');
        }
    } finally {
        // Put the document back exactly as it was found — a checkout with real tasks published must
        // come out of this run unchanged.
        for (const id of created) await removeExtraTask(id);
        if (before === null || before === undefined) await documentWrite(TASKS_KEY, '').catch(() => {});
        else await documentWrite(TASKS_KEY, before);
        const settled = await extraOneTimeTasks();
        console.log('');
        console.log(`Stored tasks restored: ${settled.length} (${settled.map((task) => task.id).join(', ') || 'none'})`);
    }

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    for (const f of failed) console.log(`  FAILED: ${f.label}`);
    console.log('');
    process.exit(failed.length ? 1 : 0);
})().catch((error) => {
    console.error('Harness failed:', error);
    process.exit(1);
});
