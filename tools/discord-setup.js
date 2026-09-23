#!/usr/bin/env node
/**
 * Build the Discord server from `lib/discord-structure.js`.
 *
 *     node tools/discord-setup.js                     # plan only, writes nothing
 *     node tools/discord-setup.js --apply             # do it
 *     node tools/discord-setup.js --apply --refresh-content
 *     node tools/discord-setup.js --wire-app          # point Discord at /api/discord/interactions
 *     node tools/discord-setup.js --sync              # re-grant roles for every linked account
 *     node tools/discord-setup.js --test-post         # prove the pasted webhook URL works
 *     node tools/discord-setup.js --list              # who has linked a wallet
 *     node tools/discord-setup.js --unlink 123456789012345678
 *
 * WHY A DRY RUN IS THE DEFAULT
 * ----------------------------
 * Because the first person to run this is the owner, on their own server, possibly at 2am. Planning
 * costs nothing and prints exactly what would change, so the decision to write is one they made
 * deliberately. `--apply` is the only flag that talks to Discord with a method other than GET.
 *
 * WHAT IT DOES AFTER WRITING, AND WHY
 * -----------------------------------
 * It reads the server back and plans again. A tool that reports success has told you what it did; a
 * tool that reports success **and shows you an empty second plan** has told you the server now matches
 * the file. That second plan is printed in full, and any step left in it is a failure that was
 * swallowed somewhere.
 *
 * THE TOKEN
 * ---------
 * `DISCORD_BOT_TOKEN` comes from the shell, never from `.env.local` — the same rule the X consumer
 * secret follows in this project. It is powerful and it is not needed by anyone reading the code. The
 * application id and the public key are not secrets and are printed for pasting into Vercel.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

function load(relative) {
    return import(pathToFileURL(path.join(ROOT, relative)).href);
}

function parseArgs(argv) {
    const args = { apply: false, refreshContent: false, wireApp: false, url: null, unlink: null, list: false, clientId: null, sync: false, testPost: false, help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--apply') args.apply = true;
        else if (arg === '--plan') args.apply = false;
        else if (arg === '--refresh-content') args.refreshContent = true;
        else if (arg === '--wire-app') args.wireApp = true;
        else if (arg === '--sync') args.sync = true;
        else if (arg === '--test-post') args.testPost = true;
        else if (arg === '--list') args.list = true;
        else if (arg === '--unlink') { args.unlink = argv[index + 1] || ''; index += 1; }
        else if (arg === '--client-id') { args.clientId = argv[index + 1] || null; index += 1; }
        else if (arg === '--url') { args.url = argv[index + 1] || null; index += 1; }
        else if (arg === '--help' || arg === '-h') args.help = true;
    }
    return args;
}

function heading(text) {
    console.log('');
    console.log(text);
    console.log('-'.repeat(text.length));
}

(async () => {
    const args = parseArgs(process.argv.slice(2));
    const Structure = await load(path.join('lib', 'discord-structure.js'));
    const Api = await load(path.join('lib', 'discord-api.js'));

    if (args.help) {
        console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
        return;
    }

    // ------------------------------------------------------------------------ the webhook probe
    // Writes nothing, needs no token, and answers one question: is the URL the owner pasted into
    // Vercel actually able to post? A webhook that was deleted in Discord fails silently forever
    // otherwise, which is the failure mode nobody notices until an announcement goes nowhere.
    if (args.testPost) {
        const Notify = await load(path.join('lib', 'discord-notify.js'));
        heading('Webhook test');
        const status = Notify.slotStatus();
        const wanted = Object.entries(status).filter(([, set]) => set).map(([slot]) => ({ slot }));
        if (!wanted.length) {
            console.log('  neither DISCORD_WEBHOOK_ANNOUNCE nor DISCORD_WEBHOOK_ACTIVITY is set.');
            console.log('  Paste one in (or export it in this shell) and run this again.');
            process.exitCode = 1;
            return;
        }
        for (const entry of wanted) {
            const result = await Notify.notifyDiscord('test', {});
            console.log(result.ok ? `  ${entry.slot}: posted (status ${result.status})` : `  ${entry.slot}: not posted — ${result.reason}`);
        }
        return;
    }

    // -------------------------------------------------------------------------- the reconciler
    // The roles are derived state, so they can always be worked out again from the links. This is
    // what makes `/claim` allowed to give up on a slow chain read: the pair (link, roles) is
    // reconciled here, for everyone, whenever a person runs it.
    if (args.sync) {
        if (!Api.botToken()) {
            console.log('  DISCORD_BOT_TOKEN is not set, so roles cannot be granted.');
            process.exitCode = 1;
            return;
        }
        const Link = await load(path.join('lib', 'discord-link.js'));
        const Roles = await load(path.join('lib', 'discord-roles.js'));
        const rows = await Link.listLinks();
        heading(`Reconciling ${rows.length} linked account(s)`);
        let failed = 0;
        for (const row of rows) {
            const result = await Roles.syncMemberRoles(row.discordId, row.address);
            if (result.ok) {
                const changed = [...result.granted.filter(() => true)];
                console.log(`  ${row.discordId}  ${changed.join(', ') || 'no roles'}${result.unknown.length ? `  (could not read: ${result.unknown.join(', ')})` : ''}`);
                await Link.recordSyncedRoles(row.discordId, result.granted).catch(() => null);
            } else {
                failed += 1;
                console.log(`  ${row.discordId}  FAILED: ${result.error}`);
            }
        }
        process.exitCode = failed ? 1 : 0;
        return;
    }

    // ------------------------------------------------------------------- the two store commands
    // They touch our own database rather than Discord, so they work with no token and no server.
    if (args.list || args.unlink) {
        const Link = await load(path.join('lib', 'discord-link.js'));
        heading(`Wallet links (${Link.storageDescription()})`);
        if (args.unlink) {
            const result = await Link.unlinkDiscord(args.unlink);
            console.log(result.removed ? `unlinked ${args.unlink} from ${result.address}` : `nothing to do: ${result.reason}`);
            return;
        }
        const rows = await Link.listLinks();
        if (!rows.length) console.log('  nobody has linked a wallet yet');
        for (const row of rows) {
            console.log(`  ${row.discordId}  ${row.address}  ${row.username ? `@${row.username}` : ''}  roles: ${(row.roles || []).join(', ') || 'none yet'}`);
        }
        return;
    }

    // The application record is read with the token when there is one, and skipped when there is
    // not: without a token the tool can still print the invite URL, which is what a person needs
    // before they have anything to run.
    const app = Api.botToken() ? await Api.fetchApplication() : { ok: false, message: 'DISCORD_BOT_TOKEN is not set' };
    const clientId = args.clientId || (app.ok ? app.application.id : null);

    if (args.wireApp) {
        const Setup = await load(path.join('lib', 'discord-setup.js'));
        const base = (args.url || 'https://dungeonknights.io').replace(/\/$/, '');
        const endpoint = `${base}/api/discord/interactions`;

        heading('Pointing Discord at our interaction endpoint');
        // Preflight, because Discord's own validation only ever reports one opaque sentence. An
        // unsigned POST is what a stranger would send, so a 401 means the route is deployed and is
        // refusing anything it cannot verify. A 404 or a connection error means it is not there yet,
        // and there is no point spending the call.
        let probe = null;
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-signature-ed25519': '00', 'x-signature-timestamp': String(Math.floor(Date.now() / 1000)) },
                body: JSON.stringify({ type: 1 }),
                cache: 'no-store',
            });
            probe = response.status;
        } catch (error) {
            probe = `unreachable (${error?.message || error})`;
        }
        console.log(`  ${endpoint} answers ${probe} to an unsigned request`);
        if (probe !== 401) {
            console.log('  a 401 is what "deployed and checking signatures" looks like, so this is not ready yet.');
            console.log('  deploy the site first, then run this again.');
            process.exitCode = 1;
            return;
        }

        const wired = await Setup.wireInteractionsEndpoint(endpoint);
        console.log(wired.ok ? `  Discord accepted the endpoint: ${wired.endpoint}` : `  refused: ${wired.message}`);
        if (wired.ok) {
            console.log('  run /whoami in Discord to prove the round trip.');
        }
        process.exitCode = wired.ok ? 0 : 1;
        return;
    }

    if (!Api.botToken()) {
        heading('Before this can do anything');
        console.log('  DISCORD_BOT_TOKEN is not set. Three steps, once:');
        console.log('');
        console.log('  1. Create the application: https://discord.com/developers/applications');
        console.log('     Bot tab, Reset Token, copy it. General Information has the Public Key.');
        console.log('  2. Invite the bot to your server with the URL below.');
        console.log('  3. Run this again with the token and the server id in the shell:');
        console.log('');
        console.log('     DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... node tools/discord-setup.js');
        console.log('');
        if (clientId) {
            console.log(`  Invite URL (grants exactly what the build needs):`);
            console.log(`    ${Structure.inviteUrl(clientId)}`);
        } else {
            console.log('  Pass --client-id <application id> to print the invite URL without a token.');
        }
        process.exitCode = 1;
        return;
    }

    // ------------------------------------------------------------------------------ plan or apply
    const Setup = await load(path.join('lib', 'discord-setup.js'));
    const state = await Api.fetchGuildState();

    heading(`Server state${app.ok ? ` (application: ${app.application.name}, id ${app.application.id})` : ''}`);

    if (!state.ok) {
        console.log(`  ${state.blocked}`);
        if (clientId) {
            console.log('');
            console.log('  Invite the bot here, then run again:');
            console.log(`    ${Structure.inviteUrl(clientId)}`);
        }
        process.exitCode = 1;
        return;
    }

    if (app.ok) {
        console.log(`  application id   ${app.application.id}      → DISCORD_APPLICATION_ID`);
        console.log(`  public key       ${app.application.publicKey}    → DISCORD_PUBLIC_KEY`);
    }
    console.log(`  guild            ${state.guild.name} (${state.guild.id})`);
    console.log(`  bot's top role   ${state.guild.bot.position === null ? 'unknown' : state.guild.bot.position}`);
    if (state.incomplete.length) {
        console.log(`  WARNING          could not read: ${state.incomplete.join(', ')}. A partial plan re-creates what already exists, so fix this first.`);
        process.exitCode = 1;
        return;
    }

    const plan = Structure.computePlan({ guild: state.guild, options: { refreshContent: args.refreshContent } });

    heading(`Plan (${plan.steps.length} write(s), ${plan.kept.length} already right)`);
    for (const line of Structure.describePlan(plan)) console.log(`  ${line}`);

    for (const blocker of plan.blockers) {
        console.log('');
        console.log(`  BLOCKED: ${blocker.why}`);
        console.log(`           fix: ${blocker.fix}`);
    }

    if (!args.apply) {
        heading('Nothing was written');
        console.log('  This was a plan. Add --apply to perform it.');
        return;
    }

    heading('Applying');
    const applied = await Setup.applyPlan(plan, { log: (line) => console.log(`  ${line}`) });
    for (const error of applied.errors) console.log(`  REFUSED  ${error.label}: ${error.message}`);

    if (Object.keys(applied.webhookUrls).length) {
        heading('Webhook URLs (shown once, and only once)');
        console.log('  Discord never shows a webhook token again. Paste these into Vercel');
        console.log('  (Settings → Environment Variables → Production), then redeploy:');
        console.log('');
        for (const [slot, entry] of Object.entries(applied.webhookUrls)) {
            const env = slot === 'announce' ? 'DISCORD_WEBHOOK_ANNOUNCE' : 'DISCORD_WEBHOOK_ACTIVITY';
            console.log(`    ${env.padEnd(28)} #${entry.channel}`);
            console.log(`      ${entry.url}`);
        }
        console.log('');
        console.log('  A webhook URL is a password for that channel. Do not paste it anywhere public.');
    }

    // -------------------------------------------------------------------------- did it converge?
    heading('Reading the server back');
    const after = await Api.fetchGuildState();
    if (!after.ok) {
        console.log(`  could not re-read the guild: ${after.blocked}`);
        process.exitCode = 1;
        return;
    }
    const second = Structure.computePlan({ guild: after.guild, options: { refreshContent: args.refreshContent } });
    if (second.steps.length === 0) {
        console.log('  the server now matches the file: a second plan finds nothing to write');
    } else {
        console.log(`  ${second.steps.length} step(s) are still outstanding, which means something did not land:`);
        for (const line of Structure.describePlan(second)) console.log(`    ${line}`);
        process.exitCode = 1;
    }

    heading('What is left for a human');
    const slots = (await load(path.join('lib', 'discord-notify.js'))).slotStatus();
    console.log(`  announcements webhook   ${slots.announce ? 'set' : 'not set — DISCORD_WEBHOOK_ANNOUNCE'}`);
    console.log(`  activity webhook        ${slots.activity ? 'set' : 'not set — DISCORD_WEBHOOK_ACTIVITY'}`);
    console.log('  staff roles: give Keeper to yourself, then Sentinel and Herald to whoever moderates.');
    console.log('  drag the bot\'s role above the roles it manages, or /claim cannot grant anything.');
    console.log('  when the site is deployed: node tools/discord-setup.js --wire-app');
    console.log('  optional: DISCORD_ACTIVITY_SHOW_HANDLES=true names the X handle on signup posts.');
    process.exitCode = applied.ok ? 0 : 1;
})();
