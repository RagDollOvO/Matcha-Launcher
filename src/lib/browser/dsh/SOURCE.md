# DSH Browser · Matcha adaptation

Upstream: https://github.com/Nono-neko/dsh-browser
Version: 0.4.1
Revision: 3b30aa740ece9cc2057cb9c81bf1e5df5f1bef3e
License: Apache-2.0; full text in docs/licenses/DSH-Browser-LICENSE.txt.

`store.ts`, `persist.ts`, and `url.ts` derive from upstream client/store.ts,
client/persist.ts, and core/url.ts. The Svelte Browser page adapts the upstream
tab strip / toolbar / lazy tab lifecycle to Matcha's existing shell.

Changes (2026-11-16): Svelte binding; native WebView2 navigation observations;
Original Flare persistence namespace; HTTP(S)-only restore; tab ID validation; active-tab
selection before cap trimming; start-page history reset. The native adapter
replaces upstream Puppeteer DOM-copy/iframe rendering for live video, logins,
and downloads. DSH host, editor, workspace files, and review tools are not shipped.
Pi remains Matcha's assistant. No automatic upstream installation or updates.
