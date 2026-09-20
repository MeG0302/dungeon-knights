'use client';

import { useEffect } from 'react';
import { STATIC_PAGES } from '../lib/static-pages';

function absolute(path) {
  if (/^https?:\/\//.test(path) || path.startsWith('/')) return path;
  return `/${path}`;
}

export default function LegacyPage({ pageKey }) {
  const page = STATIC_PAGES[pageKey];

  useEffect(() => {
    if (!page) return undefined;

    let cancelled = false;

    const load = (src) =>
      new Promise((resolve) => {
        const url = absolute(src);
        if (document.querySelector(`script[data-legacy-src="${url}"]`)) {
          resolve();
          return;
        }
        const el = document.createElement('script');
        el.src = url;
        el.async = false;
        el.dataset.legacySrc = url;
        el.onload = () => resolve();
        el.onerror = () => resolve();
        document.body.appendChild(el);
      });

    (async () => {
      for (const src of page.scripts) {
        if (cancelled) return;
        await load(src);
      }
      if (cancelled) return;
      if (page.theme) {
        document.body.setAttribute('data-dungeon-theme', page.theme);
      }
      // Legacy controllers bind their boot logic to DOMContentLoaded, which has
      // already fired by the time these scripts are injected. Re-fire it
      // (bubbling so window listeners such as game.js also run).
      document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
    })();

    return () => {
      cancelled = true;
      try {
        if (window.game) window.game.isRunning = false;
        delete window.game;
        delete window.ui;
      } catch {
        // ignore
      }
    };
  }, [page, pageKey]);

  if (!page) return null;

  return (
    <>
      {page.styles.map((href, i) => (
        <link key={`${href}-${i}`} rel="stylesheet" href={absolute(href)} />
      ))}
      {page.inlineStyles.map((css, i) => (
        <style key={`inline-${i}`} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      {/* Phones get their own sheet per route. It is loaded after the legacy theme so its
          rules win at equal specificity, and it is inert until its media query matches. */}
      {pageKey === 'landing' && (
        <link rel="stylesheet" href="/landing-mobile.css" />
      )}
      {pageKey === 'menu' && (
        <link rel="stylesheet" href="/menu-mobile.css" />
      )}
      {pageKey === 'mint' && (
        <link rel="stylesheet" href="/mint-mobile.css" />
      )}
      <div dangerouslySetInnerHTML={{ __html: page.body }} />
    </>
  );
}
