# Kitestring

Drift, then come back to it.

A calm focus timer with tasks, notes, layered sounds and optional account sync.
Free and local-first, with one React codebase for the web and the Electron Mac app.
The core tools work offline after loading. Music embeds, radio and photo themes
use the network when chosen.

```sh
npm ci
npm run dev
```

Build with `npm run build`. For the localhost companion, run
`node scripts/companion.mjs` after building. See [SPEC.md](SPEC.md),
[web/Mac parity](docs/PARITY.md), [Mac build and install](desktop/README.md)
and [the code walkthrough](docs/learn/index.html).

Checks:

```sh
npx tsc -p tsconfig.app.json --noEmit
npx vitest run --no-file-parallelism
npm --prefix desktop ci
node desktop/node_modules/electron/install.js
npm run test:browser
(cd desktop && node --test)
npm run build
```

Browser tests use disposable headless Chrome profiles. Artwork masters live in
`brand/`; regenerate with `npm --prefix desktop run build:icon` on macOS.
Asset sources and redistribution terms are in [public/LICENSES.md](public/LICENSES.md).

The Kitestring rename keeps existing storage identifiers and Mac data. Both
`custom-pomodoro-backup` and `kitestring-backup` files import; new downloads use
`kitestring-settings-YYYY-MM-DD.json`. Moving to another web hostname creates a
separate browser profile: export/import or sign in to sync the chosen data.

Cloudflare configuration contains placeholders only. Copy
`deploy/wrangler.example.jsonc` to ignored `deploy/wrangler.local.jsonc`, then fill
the D1 ID, Access team domain and audience for your own account. Keep the existing
D1 database `custom-pomodoro-sync` when updating an existing installation.
After the authentication and release checks in [worker/AUTH.md](worker/AUTH.md):

```sh
npm run build
npx wrangler@4.152.0 deploy --config deploy/wrangler.local.jsonc --var "ALLOWED_EMAILS:$CP_EMAIL"
```

The Worker name is `kitestring`. Add its hostname to the existing Access
application before cutover. Keep the old Worker answering `/api/sync` for older
Mac builds and redirect only its page routes after the new Worker is verified.
No deployment is performed by the rename itself. Private job notes and local
deployment settings are ignored; publish only a separately reviewed clean tree.
