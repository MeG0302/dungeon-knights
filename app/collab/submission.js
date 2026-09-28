'use client';

/**
 * The request-a-collab section of `/collab`.
 *
 * A project fills a form, we read it, and if we approve it the project uploads the profile picture it
 * posts from — and the announcement card makes itself out of that picture and ours.
 *
 * Four decisions are worth spelling out:
 *
 *   - **The request is the wallet's, and only its own.** Every verb here is authenticated with the
 *     signed session, and the store keys a request by the wallet that sent it — so this section can
 *     read back the one row that belongs to whoever is looking, and has no way to ask about anybody
 *     else's. That is what makes "will you collaborate with us" safe to ask in a public page.
 *   - **Nothing is approved here.** There is no approve button on this section and no route behind it
 *     that sets a status. A request is born `pending`, and only the owner moves it — from
 *     `/collab/review` (their own signed wallet, checked against `lib/collab-owners.js`) or from
 *     `tools/collab-requests.js`. A status *this* browser could set would be a status nobody had
 *     decided.
 *   - **The picture is shrunk and re-encoded before it is uploaded**, on a canvas, to a 512px JPEG.
 *     Three reasons, and all three are about the store rather than about the picture: the bytes are
 *     capped, the format is normalised, and the store holds it as one value next to the request rather
 *     than needing a second storage system for files.
 *   - **The card is drawn here.** See `lib/collab-card.js` for why the browser draws it rather than
 *     the server — in one line: the page already has the typeface, and a rasterised card is what
 *     `canvas.toBlob` is for.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CONTACT, OUR_PFP, PHOTO_DATA_URL_MAX, SUBMISSION, SUBMISSION_FIELDS } from '../../lib/collab-content';
import { CARD_SIZES, canvasToPng, cardFilename, prizeLineFor, renderCard } from '../../lib/collab-card';
import { ensureSession, tokenIfSigned } from '../../lib/collab-session';

/** A blank form, and the shape a rejected or pending request is loaded back into. */
const BLANK = { name: '', handle: '', prize: '', dates: '', note: '' };

/** What the button says while something is happening. */
const BUSY_LABEL = {
    connect: 'Connecting…',
    sign: 'Waiting for signature…',
    send: 'Sending…',
    photo: 'Reading your picture…',
    withdraw: 'Withdrawing…',
};

function formOf(request) {
    if (!request) return BLANK;
    return {
        name: request.name || '',
        handle: request.handle ? `@${request.handle}` : '',
        prize: request.prize || '',
        dates: request.dates || '',
        note: request.note || '',
    };
}

/**
 * Shrink and re-encode a chosen file into the `data:` URL we send.
 *
 * Centre-cropped to a square and drawn onto the panel colour rather than left transparent, because
 * the store takes a JPEG: a PNG's alpha would otherwise be flattened to black by the encoder, which
 * is a picture nobody chose. Quality steps down until it is under the cap, so a big phone photo is
 * still accepted rather than refused for being what it is.
 */
async function toUploadPhoto(file) {
    const bitmap = await new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as a picture.')); };
        image.src = url;
    });

    const side = 512;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#161310';
    ctx.fillRect(0, 0, side, side);
    const source = Math.min(bitmap.naturalWidth || side, bitmap.naturalHeight || side);
    ctx.drawImage(
        bitmap,
        Math.round(((bitmap.naturalWidth || side) - source) / 2),
        Math.round(((bitmap.naturalHeight || side) - source) / 2),
        source, source,
        0, 0, side, side
    );

    for (const quality of [0.92, 0.82, 0.72]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) continue;
        const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(blob);
        });
        if (dataUrl.length <= PHOTO_DATA_URL_MAX) return dataUrl;
    }
    throw new Error('That picture is still too large after resizing. A square one under a megabyte will fit.');
}

export default function CollabSubmission({ address, signed, onAddress }) {
    const [request, setRequest] = useState(null);
    const [form, setForm] = useState(BLANK);
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [cardBusy, setCardBusy] = useState(false);
    const [cardError, setCardError] = useState(null);
    const [cardDrawn, setCardDrawn] = useState(false);

    const canvasRef = useRef(null);
    const fileRef = useRef(null);

    /** This wallet's own request, or null. Never a list, never somebody else's row. */
    const load = useCallback(async () => {
        const token = await tokenIfSigned();
        if (!token) {
            setLoaded(true);
            return null;
        }
        const res = await fetch('/api/collab/submission', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            // A session that has gone is not an error worth showing: the page simply does not know of
            // a request yet, and pressing anything asks for a fresh signature.
            setLoaded(true);
            return null;
        }
        setRequest(body?.request || null);
        setForm(formOf(body?.request));
        setLoaded(true);
        return body?.request || null;
    }, []);

    useEffect(() => { load().catch(() => setLoaded(true)); }, [load, signed]);

    /**
     * The card, drawn whenever there is a picture to draw it from.
     *
     * Awaited fonts, then a canvas the visitor can see — the preview *is* the artifact, at its own
     * resolution and scaled by CSS, so what get downloaded is what was on screen.
     */
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !request?.photo || request.status !== 'approved') return undefined;
        let live = true;
        setCardBusy(true);
        setCardError(null);
        renderCard(canvas, {
            leftSrc: OUR_PFP,
            rightSrc: request.photo,
            handle: request.handle,
            prize: prizeLineFor(request),
        })
            .then(() => { if (live) setCardDrawn(true); })
            .catch((err) => { if (live) setCardError(err?.message || 'The card could not be drawn.'); })
            .finally(() => { if (live) setCardBusy(false); });
        return () => { live = false; };
    }, [request?.photo, request?.status, request?.handle, request?.prize, request]);

    /** Every write goes through here: connect if needed, sign if needed, then send. */
    const withSession = useCallback(async (work) => {
        const session = await ensureSession({ address, onStep: (step) => setBusy(step) });
        // Nothing came back: the Privy login is still open, or it was closed. Both are visible on
        // screen, so there is nothing to announce.
        if (!session) return null;
        if (session.address && session.address !== address) onAddress?.(session.address);
        return work(session);
    }, [address, onAddress]);

    const field = (key) => ({
        value: form[key],
        maxLength: (SUBMISSION_FIELDS.find((entry) => entry.key === key) || {}).max,
        onChange: (event) => setForm((prev) => ({ ...prev, [key]: event.target.value })),
    });

    const send = async (event) => {
        event.preventDefault();
        if (busy) return;
        setError(null);
        setNotice(null);

        const missing = SUBMISSION_FIELDS.filter((entry) => entry.required && !String(form[entry.key] || '').trim());
        if (missing.length) {
            setError(`Fill in ${missing.map((entry) => entry.label.toLowerCase()).join(', ')}.`);
            return;
        }

        try {
            const result = await withSession(async (session) => {
                setBusy('send');
                const res = await fetch('/api/collab/submission', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
                    body: JSON.stringify(form),
                });
                const body = await res.json().catch(() => null);
                if (!res.ok) throw new Error(body?.error || 'That did not go through. Try again in a moment.');
                return body;
            });
            if (!result) return;
            setRequest(result.request);
            setForm(formOf(result.request));
            setEditing(false);
            setNotice(result.resubmitted
                ? 'Sent again. We read it from @' + CONTACT.handle + '.'
                : 'Your request is in. We read it from @' + CONTACT.handle + ' and answer the handle you gave.');
        } catch (err) {
            if (err?.code === 4001 || /rejected|denied/i.test(err?.message || '')) {
                setNotice('Signature declined. Send it again when you are ready.');
            } else {
                setError(err?.message || 'The request could not be sent.');
            }
        } finally {
            setBusy(null);
        }
    };

    const withdraw = async () => {
        if (busy) return;
        setError(null);
        setNotice(null);
        try {
            const result = await withSession(async (session) => {
                setBusy('withdraw');
                const res = await fetch('/api/collab/submission', {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${session.token}` },
                });
                const body = await res.json().catch(() => null);
                if (!res.ok) throw new Error(body?.error || 'That did not go through.');
                return body;
            });
            if (!result) return;
            setRequest(null);
            setForm(BLANK);
            setEditing(false);
            setCardDrawn(false);
            setNotice('Withdrawn. Nothing of yours is stored now.');
        } catch (err) {
            setError(err?.message || 'The request could not be withdrawn.');
        } finally {
            setBusy(null);
        }
    };

    const upload = async (event) => {
        const file = event.target.files?.[0];
        if (!file || busy) return;
        setError(null);
        setNotice(null);
        try {
            setBusy('photo');
            const photo = await toUploadPhoto(file);
            const result = await withSession(async (session) => {
                setBusy('photo');
                const res = await fetch('/api/collab/submission/photo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
                    body: JSON.stringify({ photo }),
                });
                const body = await res.json().catch(() => null);
                if (!res.ok) throw new Error(body?.error || 'That picture was not accepted.');
                return body;
            });
            if (!result) return;
            setRequest((prev) => ({ ...prev, photo, photoMime: result.mime, photoBytes: result.bytes, photoAt: result.photoAt }));
            setCardDrawn(false);
            setNotice('Picture saved. Your card is below — download it and post it.');
        } catch (err) {
            setError(err?.message || 'The picture could not be uploaded.');
        } finally {
            setBusy(null);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    /** A fresh off-screen render, so the download is never the preview's crop. */
    const download = async () => {
        if (!request?.photo) return;
        setError(null);
        try {
            setBusy('card');
            const canvas = document.createElement('canvas');
            await renderCard(canvas, {
                leftSrc: OUR_PFP,
                rightSrc: request.photo,
                handle: request.handle,
                prize: prizeLineFor(request),
            });
            const blob = await canvasToPng(canvas);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = cardFilename(request.handle);
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        } catch (err) {
            setError(err?.message || 'The card could not be saved.');
        } finally {
            setBusy(null);
        }
    };

    const status = request?.status || null;
    const formVisible = !request || status === 'rejected' || editing;

    return (
        <section className="collab-section collab-submit" id="submit">
            <div className="collab-section-head">
                <p className="collab-eyebrow">{SUBMISSION.eyebrow}</p>
                <h2 className="collab-section-title">{SUBMISSION.title}</h2>
                <p className="collab-section-sub">{SUBMISSION.sub}</p>
            </div>

            {error && (
                <div className="collab-banner is-error" role="alert">
                    <span>{error}</span>
                    <button className="collab-banner-x" onClick={() => setError(null)} aria-label="Dismiss" type="button">✕</button>
                </div>
            )}
            {notice && (
                <div className="collab-banner is-notice" role="status">
                    <span>{notice}</span>
                    <button className="collab-banner-x" onClick={() => setNotice(null)} aria-label="Dismiss" type="button">✕</button>
                </div>
            )}

            <div className="collab-panel">
                {loaded && !address && (
                    <p className="collab-submit-intro">{SUBMISSION.needsWallet}</p>
                )}
                {address && !request && (
                    <p className="collab-submit-intro">{SUBMISSION.intro}</p>
                )}

                {status === 'pending' && !editing && (
                    <div className="collab-state">
                        <h3 className="collab-state-title">{SUBMISSION.pendingTitle}</h3>
                        <dl className="collab-summary">
                            <div className="collab-summary-row">
                                <dt>Project</dt>
                                <dd>{request.name}</dd>
                            </div>
                            <div className="collab-summary-row">
                                <dt>Posting from</dt>
                                <dd>@{request.handle}</dd>
                            </div>
                            <div className="collab-summary-row">
                                <dt>Giveaway</dt>
                                <dd>{request.prize}</dd>
                            </div>
                            {request.dates && (
                                <div className="collab-summary-row">
                                    <dt>Dates</dt>
                                    <dd>{request.dates}</dd>
                                </div>
                            )}
                            {request.note && (
                                <div className="collab-summary-row">
                                    <dt>Note</dt>
                                    <dd>{request.note}</dd>
                                </div>
                            )}
                        </dl>
                        <p className="collab-register-note">{SUBMISSION.pendingBody}</p>
                        <div className="collab-actions">
                            <button type="button" className="btn btn-ghost btn-md" onClick={() => setEditing(true)} disabled={!!busy}>
                                {SUBMISSION.edit}
                            </button>
                            <button type="button" className="btn btn-ghost btn-md collab-danger" onClick={withdraw} disabled={!!busy}>
                                {busy === 'withdraw' ? BUSY_LABEL.withdraw : SUBMISSION.withdraw}
                            </button>
                        </div>
                    </div>
                )}

                {status === 'rejected' && (
                    <div className="collab-state">
                        <h3 className="collab-state-title">{SUBMISSION.rejectedTitle}</h3>
                        {request.decidedNote && <p className="collab-state-copy">{request.decidedNote}</p>}
                        <p className="collab-state-copy">{SUBMISSION.rejectedBody}</p>
                    </div>
                )}

                {status === 'approved' && (
                    <div className="collab-state is-approved">
                        <h3 className="collab-state-title">{SUBMISSION.approvedTitle}</h3>
                        <p className="collab-state-copy">{SUBMISSION.approvedBody}</p>

                        <div className="collab-approval">
                            <div className="collab-approval-preview">
                                {request.photo ? (
                                    <img className="collab-approval-photo" src={request.photo} alt="Your profile picture" />
                                ) : (
                                    <span className="collab-approval-empty" aria-hidden="true">?</span>
                                )}
                            </div>
                            <div className="collab-approval-side">
                                <label className="collab-upload">
                                    <input
                                        ref={fileRef}
                                        className="collab-upload-input"
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        onChange={upload}
                                        disabled={!!busy}
                                    />
                                    <span className="btn btn-primary btn-md collab-upload-btn">
                                        {busy === 'photo' ? BUSY_LABEL.photo : request.photo ? 'Replace picture' : 'Upload profile picture'}
                                    </span>
                                </label>
                                <p className="collab-register-note">
                                    Square works best, and it is resized to 512px before it is sent.
                                    {request.photoBytes ? ` Last picture: ${Math.round(request.photoBytes / 1024)} KB.` : ''}
                                </p>
                            </div>
                        </div>

                        {request.photo && (
                            <div className="collab-card">
                                <div className="collab-card-head">
                                    <p className="collab-card-note">{CARD_SIZES.post.note}</p>
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-md"
                                        onClick={download}
                                        disabled={!!busy}
                                    >
                                        {busy === 'card' ? 'Making the picture…' : 'Download the PNG'}
                                    </button>
                                </div>
                                <canvas
                                    className={`collab-canvas${cardDrawn ? ' is-drawn' : ''}`}
                                    ref={canvasRef}
                                    aria-label="Your collab announcement card"
                                />
                                {cardError && <p className="collab-card-error">{cardError}</p>}
                                {cardBusy && !cardError && <p className="collab-card-busy">Drawing your card…</p>}
                                <p className="collab-register-note">{SUBMISSION.cardNote}</p>
                            </div>
                        )}
                    </div>
                )}

                {formVisible && (
                    <form className="collab-form" onSubmit={send}>
                        {SUBMISSION_FIELDS.map((entry) => (
                            <label className="collab-field" key={entry.key}>
                                <span className="collab-field-label">
                                    {entry.label}
                                    {!entry.required && <span className="collab-field-optional"> optional</span>}
                                </span>
                                {entry.key === 'note' ? (
                                    <textarea className="collab-input collab-textarea" rows={3} placeholder={entry.placeholder} {...field(entry.key)} />
                                ) : (
                                    <input className="collab-input" type="text" placeholder={entry.placeholder} {...field(entry.key)} />
                                )}
                            </label>
                        ))}
                        <div className="collab-actions">
                            <button type="submit" className="btn btn-primary btn-md collab-send" disabled={!!busy}>
                                {BUSY_LABEL[busy] || (address ? 'Send request' : 'Connect wallet & send request')}
                            </button>
                            {editing && (
                                <button type="button" className="btn btn-ghost btn-md" onClick={() => { setEditing(false); setForm(formOf(request)); }} disabled={!!busy}>
                                    Cancel
                                </button>
                            )}
                        </div>
                        <p className="collab-fine">{SUBMISSION.note}</p>
                    </form>
                )}
            </div>
        </section>
    );
}
