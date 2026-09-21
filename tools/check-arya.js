#!/usr/bin/env node
/**
 * Arya's walkthrough runs once, and only "Ask Arya" brings it back.
 *
 *     node tools/check-arya.js
 *
 * Three files have to agree for that to be true, and no one of them shows it:
 *
 *   - `public/arya.js` refuses a tour whose id has been seen, *unless* it is forced — so
 *     the default is once-ever and `force` is the deliberate exception.
 *   - `app/staking/client.js` and `app/points/client.js` each call `tour()` twice: once
 *     automatically (which must **not** force, or the player is interrupted on every
 *     visit) and once from their footer button (which must force, or asking for the
 *     instructions does nothing after the first time).
 *
 * The runtime half of this lives in `tools/check-all.js` (`window.__check.arya()` drives a
 * synthetic tour unseen → skipped → refused → forced). This file is the half a browser
 * cannot show: which call sites pass `force`, and whether the buttons are still wired up.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

const arya = read('public/arya.js');
const staking = read('app/staking/client.js');
const points = read('app/points/client.js');

// ---------------------------------------------------------------- the module's default
rec('the module refuses a walkthrough it has already been through',
    /if \(!options\.force && hasSeenTour\(id\)\) return false;/.test(arya),
    'startTour gates on the seen flag');
rec('and remembers it per tour id, in this browser',
    /dk_arya_tour_\$\{id\}/.test(arya) && /function markTourSeen\(id\)/.test(arya),
    'localStorage, keyed by id');
// There is exactly one teardown, and it is the thing that writes the flag — so "did this
// walkthrough get seen" cannot depend on which way the player left it. Each exit is then
// checked to route through that teardown with the default (mark) argument, rather than by
// looking for one literal call: building the walkthrough can only ever go through startTour.
function fnBody(name) {
    const start = arya.indexOf(`function ${name}(`);
    if (start < 0) return '';
    const next = arya.indexOf('\n    function ', start + 1);
    return arya.slice(start, next === -1 ? undefined : next);
}

const stopTour = fnBody('stopTour');
rec('one teardown writes the seen flag, and only an explicit false skips it',
    /markTourSeen\(id\)/.test(stopTour) && /seen !== false/.test(stopTour),
    'stopTour is the single exit');
rec('skipping and finishing mark it seen',
    /if \(!stopTour\(true\)\) return null;/.test(fnBody('endTour')),
    'endTour marks it');
rec('so does leaving mid-way — a new walkthrough ends the one in progress',
    /if \(tour\) stopTour\(true\);/.test(fnBody('startTour')),
    'every exit path marks it');
rec('and closing the tab mid-walkthrough counts too',
    /addEventListener\('pagehide'[\s\S]{0,160}?stopTour\(true\)/.test(arya),
    'pagehide marks it — the one exit that runs no other code of ours');
rec('and no exit path can drop the flag on the floor',
    !/stopTour\(false\)/.test(arya), 'nothing calls stopTour(false)');

// ------------------------------------------------------- the two pages' call sites
/** Every `tour(TOUR_ID` call in a file, with the code just before and after it. */
function callSites(file, source) {
    const sites = [];
    for (const match of source.matchAll(/tour\(TOUR_ID/g)) {
        sites.push({
            file,
            call: source.slice(match.index, match.index + 200),
            before: source.slice(Math.max(0, match.index - 700), match.index),
        });
    }
    return sites;
}

for (const [name, source] of [['app/staking/client.js', staking], ['app/points/client.js', points]]) {
    const sites = callSites(name, source);
    rec(`${name}: calls the walkthrough exactly twice`, sites.length === 2, `${sites.length} call site(s)`);

    const forced = sites.filter((s) => /force:\s*true/.test(s.call));
    const quiet = sites.filter((s) => !/force:\s*true/.test(s.call));
    rec(`${name}: only one of them forces it`, forced.length === 1,
        `${forced.length} forced, ${quiet.length} not`);

    rec(`${name}: the forcing one is the Ask Arya button`,
        forced.length === 1 && /(askArya|handleGuide)/.test(forced[0].before),
        forced.length === 1 && /(askArya|handleGuide)/.test(forced[0].before)
            ? 'inside the handler'
            : 'force is not in a button handler');

    rec(`${name}: the automatic one is an effect, and it does not force`,
        quiet.length === 1 && /useEffect/.test(quiet[0].before),
        quiet.length === 1 && /useEffect/.test(quiet[0].before)
            ? 'the seen flag decides'
            : 'an automatic call still forces');
}

// ------------------------------------------------------------------- still askable
rec('the Staking Vault footer button is wired to its handler',
    /onClick=\{askArya\}/.test(staking), 'onClick={askArya}');
rec('the Points footer button is wired to its handler',
    /onClick=\{handleGuide\}/.test(points) && /Ask Arya/.test(points), 'onClick={handleGuide}');

console.log('');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
    console.log('');
    for (const f of failed) console.log(`  FAILED: ${f.label}`);
    process.exitCode = 1;
}
