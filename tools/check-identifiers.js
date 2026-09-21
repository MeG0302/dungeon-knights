#!/usr/bin/env node
/**
 * Does every name a module uses actually exist?
 *
 *     node tools/check-identifiers.js
 *
 * This exists because of a specific failure. The Knights side of the staking vault rendered a
 * ratio through a formatter that was never defined:
 *
 *     <strong>{pct(knightsReferenceSize.ratioOfReference)}</strong>
 *
 * `next build` compiles that happily — it is a valid call expression — and so does every Node
 * harness, because none of them renders React. So the build was green, 126 staking checks were
 * green, 64 token-economics checks were green, and the page **went completely blank** the
 * instant a player switched to the Knights side, because a `ReferenceError` during render
 * unmounts the tree and leaves an empty `body`.
 *
 * The generalisation is worth stating: a bundler proves a file *parses*, not that the names in
 * it resolve. A module that imports everything it uses and hides nothing in globals can be
 * checked for that statically, which turns a runtime crash on one render branch into a line
 * number.
 *
 * Scope is `app/` and `lib/` — the bundled modules. `public/` is deliberately excluded: those
 * are classic scripts sharing globals across seventeen files by design, so every cross-file
 * reference would be a false positive and the harness would be ignored. The bundled modules
 * have no such excuse; either a name is imported or it is a browser global.
 *
 * `no-undef` runs with `browser` and `node` globals enabled, which is wider than either
 * environment alone — this is a crash detector, not a purity check, and a global that exists in
 * production but not in the harness would be a false alarm that costs more than it saves.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCANNED = ['app', 'lib'];

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

(async () => {
    const { Linter } = await import('eslint');

    const linter = new Linter();
    const config = {
        parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
        env: { browser: true, node: true, es2022: true },
        rules: { 'no-undef': 'error' },
    };

    const files = SCANNED.flatMap((dir) => walk(path.join(ROOT, dir))).sort();

    console.log('');
    console.log('Every name a module uses');

    // The harness is only worth its output if it read something. A wrong path or an empty glob
    // would otherwise report a clean bill of health for a codebase it never opened.
    rec('the bundled modules were actually found', files.length > 20, `${files.length} files under ${SCANNED.join('/, ')}/`);

    const findings = [];
    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        for (const message of linter.verify(source, config)) {
            if (message.fatal) {
                findings.push({ file, line: message.line, text: `parse error: ${message.message}` });
            } else {
                findings.push({ file, line: message.line, text: message.message });
            }
        }
    }

    const undefinedNames = findings.filter((f) => /is not defined/.test(f.text));
    const others = findings.filter((f) => !/is not defined/.test(f.text));

    rec('no module calls a name nothing defines', undefinedNames.length === 0,
        undefinedNames.length
            ? `${undefinedNames.length} undefined name(s)`
            : `${files.length} modules resolve every name they use`);

    for (const f of undefinedNames.slice(0, 20)) {
        console.log(`        ${path.relative(ROOT, f.file)}:${f.line}  ${f.text}`);
    }

    // Anything else the parser or a future rule reports is a different failure and is not
    // silently folded into the check above, or a rule change would look like a code change.
    rec('and nothing else went wrong while reading them', others.length === 0,
        others.length ? others.map((o) => `${path.relative(ROOT, o.file)}:${o.text}`).join('; ') : 'clean');

    // The bug this was written for, pinned: the formatter that did not exist. If this line ever
    // stops being caught, the harness has stopped working rather than the codebase improving.
    const probe = `const x = ${'pct'}(0.05);\n`;
    const probeCaught = linter.verify(probe, config).some((m) => /'pct' is not defined/.test(m.message));
    rec('the check that found the blank page still fires on it', probeCaught,
        probeCaught ? 'an undefined formatter is reported with its line' : 'no longer catches it');

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
