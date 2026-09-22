'use client';

import { useState } from 'react';

/**
 * The password form.
 *
 * On success it does a **full navigation** rather than `router.push`: what has to be true afterwards
 * is that the browser sends the new cookie, and a hard load is the one way that is not a bet on
 * whether a soft navigation re-ran the middleware.
 *
 * The styles are a real sheet (`public/css/gate.css`) rather than an inline `<style>` block. A
 * root-level file is not gated — the middleware keeps assets open so this very screen can wear the
 * theme — so the sheet reaches the browser before any cookie exists, and the audit can see it.
 */
export default function GateScreen({ next }) {
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const submit = async (event) => {
        event.preventDefault();
        if (busy || !password) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/gate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                setError(body?.error || 'That password did not work. Try again.');
                setPassword('');
                return;
            }
            window.location.assign(next);
        } catch {
            setError('The server did not answer. Try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            <link rel="stylesheet" href="/css/gate.css" />
            <link
                rel="stylesheet"
                href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Cinzel+Decorative:wght@700&family=Inter:wght@400;500;600&display=swap"
            />
            <div className="gate-page">
                <form className="gate-card" onSubmit={submit}>
                    <h1 className="gate-title">Dungeon Knights</h1>
                    <p className="gate-sub">Private build</p>
                    <p className="gate-note">
                        The game is still being built, so this side is open to the team only. The
                        public site is dungeonknights.io.
                    </p>
                    <input
                        className="gate-input"
                        type="password"
                        name="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Password"
                        autoComplete="current-password"
                        autoFocus
                        disabled={busy}
                        aria-label="Password"
                    />
                    <button className="gate-button" type="submit" disabled={busy || !password}>
                        {busy ? 'Opening…' : 'Enter'}
                    </button>
                    {error && <div className="gate-error" role="alert">{error}</div>}
                    <div className="gate-footer">
                        <a href="https://dungeonknights.io">Back to dungeonknights.io</a>
                    </div>
                </form>
            </div>
        </>
    );
}
