/* ===========================================================================
 * The wallet menu — one menu behind every wallet control in the site.
 *
 * WHAT IT IS FOR
 * --------------
 * The wallet control in the header is the only place a player is always looking at, and it
 * carried exactly one action: on the landing page, nothing at all. `landing.js` binds a
 * `#connectWalletBtn` that no page body defines — the landing header is only
 * `.wallet-pill#walletWidget > #dngBalanceHeader` — so a first-time visitor on `/` could not
 * connect a wallet anywhere on the page. On the other pages the pill was a readout and the
 * disconnect button lived beside it, or in the `shared-header.js` bar.
 *
 * So this adds the one thing that control was missing: a menu. Hovering it (or tapping it, which
 * is the only version that exists on a phone) offers
 *
 *      1. My Portfolio   — the page that answers "what do I actually own?"
 *      2. Disconnect Wallet
 *
 * and a wallet that is not connected gets *Connect Wallet* instead, which is the landing page's
 * working entry point.
 *
 * HOW IT ATTACHES
 * ---------------
 * By selector, and one module rather than four: the legacy pill ids, and any `.wallet-pill` a
 * route renders. The React routes pass their own element in (`WalletMenu.attach(el, …)`) because
 * they mount after hydration and an observer would be guessing at their timing.
 *
 * `.wallet-chip` is deliberately NOT a trigger. On `/points` and `/staking` the chip is already a
 * button that disconnects on click, and two different meanings for one click is worse than one
 * affordance fewer; the pill sits in the same corner and is the thing the menu is describing.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It reads nothing from the chain. `/portfolio` does the reading, so opening a menu never costs a
 * round trip, and the menu cannot show a number that has gone stale behind it.
 * =========================================================================== */
(function () {
    'use strict';

    /** The pills, wherever they are: the three legacy ids and anything else wearing the class. */
    const TRIGGERS = ['.wallet-pill', '#walletWidget', '#walletWidgetMenu', '#walletWidgetGame'];

    /* The keys `public/wallet.js` and `lib/points-client.js` both use. One wallet across the whole
       site is the point of them, so the menu reads the same two it writes. */
    const CONNECTED_KEY = 'walletConnected';
    const ADDRESS_KEY = 'walletAddress';

    const PORTFOLIO_HREF = '/portfolio';

    const log = (...args) => console.log('[wallet-menu]', ...args);

    let closeTimer = null;
    let openTimer = null;
    let openMenu = null;   // the menu element currently shown, if any

    // ------------------------------------------------------------------ the wallet
    function currentAddress() {
        const fromManager = window.walletManager?.userAddress;
        if (typeof fromManager === 'string' && /^0x[0-9a-fA-F]{40}$/.test(fromManager)) return fromManager;
        try {
            const stored = window.localStorage.getItem(ADDRESS_KEY);
            if (/^0x[0-9a-fA-F]{40}$/.test(stored || '')) return stored;
        } catch { /* private mode */ }
        return null;
    }

    function isConnected() {
        if (window.walletManager?.isConnected) return true;
        try {
            return window.localStorage.getItem(CONNECTED_KEY) === 'true' && !!currentAddress();
        } catch {
            return false;
        }
    }

    function short(address) {
        return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'your wallet';
    }

    async function connect() {
        // `walletManager` first: it is what the legacy pages already listen to, and it publishes the
        // events their headers redraw on. `DKWallet` is the seam underneath it, and the only one a
        // React route has.
        if (window.walletManager?.connect) return window.walletManager.connect();
        if (window.DKWallet?.connect) return window.DKWallet.connect();
        throw new Error('No wallet is available in this browser.');
    }

    /**
     * Disconnect, through whichever path this page's own UI is watching.
     *
     * A page only redraws its header if it hears about the change, and the two families hear it
     * differently: the legacy pages listen for `walletDisconnected`, which `walletManager` fires,
     * while the React routes clear their own state in a handler. So the registered handler wins when
     * there is one, and the default path below is the legacy one.
     */
    async function disconnect(options) {
        if (typeof options?.onDisconnect === 'function') {
            await options.onDisconnect();
            return;
        }
        if (window.walletManager?.disconnect) {
            await window.walletManager.disconnect();
            return;
        }
        try {
            window.localStorage.removeItem(CONNECTED_KEY);
            window.localStorage.removeItem(ADDRESS_KEY);
            window.localStorage.removeItem('dk_points_session');
        } catch { /* private mode */ }
        if (window.DKWallet?.disconnect) await window.DKWallet.disconnect();
        window.dispatchEvent(new Event('walletDisconnected'));
    }

    // -------------------------------------------------------------------- the menu
    function buildMenu() {
        const menu = document.createElement('div');
        menu.className = 'wallet-menu';
        menu.setAttribute('role', 'menu');
        menu.hidden = true;
        return menu;
    }

    /** One item: the address is a row, the rest are actions. */
    function item({ tag = 'button', href, label, note, className = '', role = 'menuitem' }) {
        const el = document.createElement(tag);
        el.className = `wallet-menu-item ${className}`.trim();
        el.setAttribute('role', role);
        if (tag === 'a') el.href = href;
        if (tag === 'button') el.type = 'button';

        const text = document.createElement('span');
        text.className = 'wallet-menu-label';
        text.textContent = label;
        el.appendChild(text);

        if (note) {
            const sub = document.createElement('span');
            sub.className = 'wallet-menu-note';
            sub.textContent = note;
            el.appendChild(sub);
        }
        return el;
    }

    function fillMenu(menu, options) {
        menu.innerHTML = '';

        const address = currentAddress();
        const connected = isConnected();

        if (connected && address) {
            // The identity line. Not an action, so it is not focusable — but it is selectable, which
            // is the only way to copy an address without a clipboard permission prompt.
            const who = document.createElement('div');
            who.className = 'wallet-menu-address';
            who.innerHTML = '<span class="wallet-menu-dot" aria-hidden="true"></span>';
            const addr = document.createElement('span');
            addr.className = 'wallet-menu-addr-text';
            addr.textContent = short(address);
            addr.title = address;
            who.appendChild(addr);
            menu.appendChild(who);
            menu.appendChild(Object.assign(document.createElement('div'), { className: 'wallet-menu-sep' }));
        }

        menu.appendChild(item({
            tag: 'a',
            href: PORTFOLIO_HREF,
            label: 'My Portfolio',
            note: connected ? 'DNG, knights and points' : 'Connect a wallet to fill it',
        }));

        if (connected) {
            const out = item({ label: 'Disconnect Wallet', className: 'is-danger' });
            out.addEventListener('click', async () => {
                close();
                try {
                    await disconnect(options);
                } catch (error) {
                    console.warn('[wallet-menu] disconnect failed:', error?.message || error);
                }
            });
            menu.appendChild(out);
        } else {
            const inButton = item({ label: 'Connect Wallet', className: 'is-primary' });
            inButton.addEventListener('click', async () => {
                try {
                    await connect();
                    close();
                } catch (error) {
                    // A failed connect is the one case where the menu must stay open: the reason
                    // (no extension, a locked wallet, a rejected prompt) is the only useful thing
                    // on screen, and closing on it would leave the player with a pill that did
                    // nothing when they pressed it.
                    console.warn('[wallet-menu] connect failed:', error?.message || error);
                    menu.querySelector('.wallet-menu-error')?.remove();
                    const line = document.createElement('div');
                    line.className = 'wallet-menu-error';
                    line.textContent = window.DKWallet?.unavailableMessage?.()
                        || error?.message
                        || 'The wallet did not connect.';
                    menu.appendChild(line);
                }
            });
            menu.appendChild(inButton);
        }
    }

    /** Where the menu goes: inside the trigger's own box, so it follows the header's layout. */
    function ensureHost(trigger) {
        if (trigger.classList.contains('wallet-menu-host')) return;
        trigger.classList.add('wallet-menu-host');
    }

    function show(trigger) {
        const menu = trigger.__walletMenu;
        if (!menu) return;
        if (openMenu && openMenu !== menu) hide();
        fillMenu(menu, trigger.__walletMenuOptions);
        menu.hidden = false;
        // Visibility is a class as well as the attribute, so the open/close transition has
        // something to run on: `hidden` is a hard cut and would skip it.
        requestAnimationFrame(() => menu.classList.add('is-open'));
        trigger.setAttribute('aria-expanded', 'true');
        openMenu = menu;
    }

    function hide() {
        if (!openMenu) return;
        const menu = openMenu;
        const trigger = menu.__walletMenuTrigger;
        openMenu = null;
        menu.classList.remove('is-open');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
        // After the transition, so the close is animated too.
        setTimeout(() => {
            if (!menu.classList.contains('is-open')) menu.hidden = true;
        }, 180);
    }

    const close = hide;

    function attach(trigger, options = {}) {
        if (!trigger || trigger.__walletMenu) return null;

        ensureHost(trigger);

        const menu = buildMenu();
        menu.__walletMenuTrigger = trigger;
        menu.__walletMenuOptions = options;
        trigger.__walletMenu = menu;
        trigger.appendChild(menu);

        // The trigger is not a `<button>` on any page — it is a `<div class="wallet-pill">` — so it
        // is given the role and the tab stop rather than the semantics being assumed.
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('tabindex', trigger.getAttribute('tabindex') || '0');
        trigger.setAttribute('title', 'Wallet, portfolio and disconnect');

        // A caret, so the affordance is visible before anyone hovers. Without it the pill reads as a
        // readout and the menu is a thing you find by accident.
        if (!trigger.querySelector('.wallet-menu-caret')) {
            const caret = document.createElement('span');
            caret.className = 'wallet-menu-caret';
            caret.setAttribute('aria-hidden', 'true');
            caret.textContent = '▾';
            trigger.appendChild(caret);
        }

        trigger.addEventListener('mouseenter', () => {
            clearTimeout(closeTimer);
            openTimer = setTimeout(() => show(trigger), 120);
        });
        trigger.addEventListener('mouseleave', () => {
            clearTimeout(openTimer);
            closeTimer = setTimeout(hide, 220);
        });

        trigger.addEventListener('click', (event) => {
            // The game page's own disconnect button lives *inside* the pill. Clicking it must not
            // also open this menu — the two actions are already different buttons.
            if (event.target.closest('button, a')) return;
            event.preventDefault();
            if (trigger.__walletMenu && !trigger.__walletMenu.hidden) hide();
            else show(trigger);
        });

        trigger.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                event.preventDefault();
                show(trigger);
                menu.querySelector('.wallet-menu-item')?.focus();
            } else if (event.key === 'Escape') {
                hide();
            }
        });

        menu.addEventListener('keydown', (event) => {
            const items = [...menu.querySelectorAll('.wallet-menu-item')];
            const at = items.indexOf(document.activeElement);
            if (event.key === 'Escape') {
                hide();
                trigger.focus();
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                (items[at + 1] || items[0])?.focus();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                (items[at - 1] || items[items.length - 1])?.focus();
            }
        });

        return menu;
    }

    /** Attach to every control this page has, once each. */
    function scan(root = document) {
        for (const selector of TRIGGERS) {
            for (const trigger of root.querySelectorAll(selector)) attach(trigger);
        }
    }

    document.addEventListener('click', (event) => {
        if (!openMenu) return;
        if (event.target.closest('.wallet-menu-host')) return;
        hide();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && openMenu) hide();
    });

    // A page that navigates away (or a route change) must not leave a menu hanging over the new
    // content — the legacy pages inject scripts per route, so this fires more often than it looks.
    window.addEventListener('pagehide', hide);

    function start() {
        scan();
        const found = document.querySelectorAll('.wallet-menu-host').length;
        log('ready —', found, 'wallet control(s) have a menu');
    }

    window.WalletMenu = {
        attach,
        scan,
        open: show,
        close: hide,
        isConnected,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
