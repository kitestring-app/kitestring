# Account login and sync

Job 18 adds email/password sign-in to the hosted dashboard and the Mac app. The localhost companion stays local-only. Signed-out hosted use also stays local. There is no signup route. The existing `kv` rows remain keyed by email.

The checked-in config did not contain the account address mentioned in the job. `ALLOWED_EMAILS` is therefore empty and rejects everyone until the lead supplies the address. Do not deploy this empty value. Supply the allowed address through the deployment command below; no personal address needs to enter source control.

## How it works

Passwords use PBKDF2-SHA256 with a fresh 16-byte salt and a 32-byte result. Each user stores its own iteration count. Comparison examines every hash character. Login errors are identical for unknown emails and wrong passwords. D1 reserves attempt slots before hashing so overlapping requests cannot exceed five failures per email or client IP in 15 minutes. Successful attempts release their slots. A blocked request returns 429 and `Retry-After`, using only a primary-key lookup of its two limiter keys. Expiry cleanup runs only after a successful login, deleting at most 50 expired limiter rows and 50 expired sessions. Migration `0002_login_attempts_expiry.sql` adds the `window_start` index; `0001_accounts.sql` is unchanged, so local databases that already applied it can upgrade. Cleanup uses indexed expiry subqueries with `LIMIT 50` and primary-key deletes.

A session is 32 random bytes. D1 stores only its SHA-256 hash, with a 60-day sliding expiry. Web requests renew both the D1 expiry and the HttpOnly, Secure, SameSite=Strict cookie scoped to `/api`. The Mac app receives a bearer token in main and saves it with Electron safeStorage encryption in `userData/cloud-session.enc`, with file mode 0600. The page receives status and data, never the token. A locked Keychain prevents sign-in. The main process pins the hosted origin, rejects redirects and only accepts the specified API route/method pairs. IPC uses the existing trusted main-frame check; the floating timer has no cloud bridge.

The first sign-in on a device with existing data pauses before any sync GET or PUT. Keep uploads the device copy; Replace downloads the account copy and clears synced values missing from it. Backup remains available before choosing. Later sync uses timestamps, runs after saves, on return to the page and every 30 seconds while visible. Uploaded backgrounds and the running timer remain device-local. Signing out revokes that session and keeps local data.

Password recovery goes through `/account/reset/`. The HTML is a Worker-owned string in `worker/reset-page.ts`, served only after Access verification. There is no internal asset fetch or canonical-redirect chain. `/reset`, `/reset/` and `/reset.html` are explicit 404s, routed through the Worker ahead of static assets and the SPA fallback. Missing/invalid Access JWTs receive 401; verified identities outside the allowlist receive 403. The external CSS and script contain no recovery HTML or credentials. Cloudflare Access sends the email PIN. The Worker independently verifies its RS256 JWT, issuer, audience, expiry and allowed email. The reset page uses external script and CSS under a strict CSP. A matching password of 12–1024 characters replaces the hash and revokes every session for that email in one D1 transaction. Access JWTs alone no longer authenticate `/api/*`.

## Sync upload bounds and revocation ordering

All sync PUT bodies are streamed through a byte counter before session lookup, with early rejection of an oversized `Content-Length`, an absolute **10-second** ingestion deadline, and cancellation on overflow or timeout. Cancellation is not awaited, so a stalled producer cannot delay the 413/408 response. A growing byte buffer caps retained bytes and avoids retaining one string per tiny input chunk. Login/reset JSON uses the same reader with an 8 KiB limit.

The whole sync request cap is **2 MiB (2,097,152 bytes)**, down from 15,200,000 bytes. Each serialized value still has the existing 1,900,000-byte cap, leaving room under D1's row limit. The largest structured sync value is stats, which keeps timer chunks and task completions. The reproducible synthetic fixture `worker/fixtures/heavy-stats.mjs` models a year of daily use: eight 25-minute focus runs per day, each paused once, eight five-minute breaks, and eight completed tasks. It has **8,760 chunks and 2,920 task completions** and measures **1,369,506 UTF-8 bytes** (1,369,570 bytes as a stats-only sync request). This uses the real field shapes and ID lengths; it is generated test data, not a measurement of anyone's private history. Both SQLite tests and local workerd accept it. The cap leaves roughly 0.7 MiB for the other values in the same upload. Longer histories or unusually large notes can still hit the documented limits; requests fail explicitly rather than truncating data.

After complete ingestion and validation, the session lookup does not renew it. The only write operation is one [D1 batch transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch): it rechecks the session, runs every upsert as `INSERT ... SELECT ... WHERE EXISTS (live session)`, and conditionally renews that session. The session predicate checks token hash, account and expiry. Reset/logout ordered before this batch makes every write a no-op and returns 401, including existing-key overwrites and empty syncs. If the sync batch commits first, its writes precede revocation. A session revoked during body ingestion cannot authorize the subsequent batch.

Tests reproduce a token holder withholding the final body bytes until after password reset/logout, and a separate race revokes or expires the session after lookup but before the write transaction. They verify 401 and unchanged data. Overflow tests leave the stream open and make cancellation itself never resolve, proving rejection does not wait for EOF or a cooperative sender. The deadline test trickles data immediately before 10 seconds and still gets 408.

This uses the existing Worker, D1, static assets and Access email PIN. It adds no paid binding, email provider or runtime dependency. D1 storage and request quotas still apply. Keep this Worker on the Free plan.

## Password CPU measurement

The chosen count is **60,000 iterations**. `node scripts/benchmark-password.mjs` measures process CPU time (user + system), including the native crypto work. It generates a throwaway password and never prints it. The run used Node 24.22.1 on the local Apple Silicon host, with five warmups and 40 measured samples per candidate.

| Iterations | Median CPU | 95th percentile | Highest sample |
| --- | --- | --- | --- |
| 50,000 | 4.039 ms | 4.538 ms | 6.381 ms |
| 55,000 | 4.319 ms | 4.486 ms | 4.859 ms |
| 60,000 | 4.684 ms | 4.838 ms | 5.032 ms |
| 65,000 | 5.070 ms | 5.216 ms | 5.252 ms |
| 70,000 | 5.430 ms | 5.703 ms | 5.758 ms |
| 80,000 | 6.254 ms | 6.695 ms | 6.829 ms |
| 100,000 | 7.790 ms | 8.069 ms | 8.283 ms |

60,000 was the highest tested count below a 5 ms p95 Node hashing budget. Those figures measure hashing alone. Iterations are stored per user so future changes do not break existing hashes; this security fix does not change the count.

### Whole-request local workerd CPU (2026-10-24)

`node scripts/test-auth-local.mjs` now runs successfully with a loopback listener. The measurement used Wrangler **4.152.0**, workerd **2026-10-19**, Node **24.22.1**, and an **Apple M4**. After five warmups per operation, the harness samples native process CPU immediately before sending each HTTP request and after consuming the complete response. It sums user + system CPU across every test-owned workerd process and all threads, including native PBKDF2 and the local D1 simulator. It discovers only descendants of its own Wrangler process. This is whole local request processing, not elapsed HTTP latency or a Node hashing microbenchmark.

On macOS the sampler uses `proc_pid_rusage` v2 through Python 3's standard-library `ctypes`, converting the host's Mach ticks with `mach_timebase_info` (125/3 on this host). A standalone CPU calibration compared 48.442 ms from `time.process_time_ns` against 48.438 ms from the converted counter. Raw ticks must not be treated as nanoseconds. No profiler/debugger is attached to the user's browser.

| Operation | Samples | Median CPU | 95th percentile | Highest sample |
| --- | --- | --- | --- | --- |
| Successful desktop login, including limiter reservation, password verification, session insert and bounded cleanup queries | 40 | 8.959 ms | 10.378 ms | 23.607 ms |
| Heavy-year stats PUT (1,369,570-byte request) | 10 | 15.665 ms | 17.554 ms | 17.554 ms |

These counters include local proxy/runtime and D1 simulation costs that are not identical to Cloudflare's per-Worker CPU accounting, plus any background CPU in those test processes during sampling. The login fixture has small tables and executes the cleanup queries without a large expired backlog; bounded cleanup correctness and query plans are covered separately by SQLite tests with 120 expired rows per table. The result is a conservative local process measurement, **not proof that production fits the 10 ms Free-plan limit**: login p95 and the largest sample exceed 10 ms in this run, and the large sync sample also exceeds it. The production CPU gate remains open. No paid plan, lower password work factor, deployment or remote test was introduced to make this result pass.

[Cloudflare Web Crypto documentation](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) describes the supported PBKDF2 API. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/) are the deployment reference. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage/) describes the OS-backed encryption boundary. The app currently uses Electron 45's synchronous safeStorage API.

## Local checks

Run these from the repository root:

```sh
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p worker/tsconfig.json --noEmit
npm run build
npx vitest run
(cd desktop && node --test)
node scripts/benchmark-password.mjs
node scripts/test-auth-local.mjs
```

The Worker unit tests use an in-memory SQLite database with all migrations and the actual SQL. They cover hash verification, rate limits and indexed/bounded maintenance, sessions, cookies, bearer auth, sync account boundaries, post-revocation writes, streaming limits/deadlines, heavy stats, signup rejection and Access-only reset HTML. Shared client tests cover transport choice, signed-out/local/signed-in/error UI, and both first-sync choices. Desktop tests cover encrypted storage and restore, token omission from replies, fixed routes/origin, local rate limiting, trusted senders and the restricted preload.

`test-auth-local.mjs` creates a temporary Wrangler project and local D1, applies both migrations, uses the provisioning CLI's SQL, and checks login, sync PUT/GET, logout, reset and old-session revocation. It uses the deployment config's real asset routing (including the SPA fallback), so `/reset` and `/reset.html` are verified as 404, `/account/reset/` as 401 without Access, and the authenticated page as 200 with no redirect. It reproduces the delayed-body reset attack over HTTP and verifies the stored notes remain unchanged, then checks heavy stats and oversized uploads. It also prints the CPU measurements above. The macOS CPU sampler requires `python3` and `ps`, and uses no added package.

The harness generates its own password and RSA key. A fixture-only entry supplies test JWKS for a `.invalid` issuer; the production Access verification code still verifies the JWT. That fixture is outside the deploy config and gets deleted after the run. It never uses `--remote` or the real D1 binding. Build first so the app assets exist. Set `CP_WRANGLER` to an existing Wrangler CLI file to avoid fetching the pinned CLI; `CP_TEST_PORT` changes its loopback port.

Current checks passed: app TypeScript, Worker TypeScript, the production build, **335 Vitest tests** (four existing browser checks skipped), **all 99 desktop Node tests**, and `node scripts/test-auth-local.mjs`. `git diff --check` and the local harness syntax check also pass. Local migrations and HTTP checks now pass; the earlier loopback `EPERM` limitation no longer applies in this environment. Real Cloudflare PIN delivery, deployed CPU accounting and a real Mac Keychain round trip remain deployment/device checks; desktop tests inject safeStorage rather than opening the user's Keychain.

## Steps for the lead

Nothing has been deployed, committed or installed in `/Applications`. The commands below are a handoff, not actions performed by this job.

1. Review the changes. Run the local checks above. Resolve the CPU gate above and confirm production-equivalent request CPU fits the Free-plan allowance before deploying. Keep a copy of the current Worker release and back up D1 before changing production.

2. Set the account address in your shell without adding it to a tracked file:

   ```sh
   read -r 'CP_EMAIL?Allowed account email: '
   ```

   This is zsh syntax. In another shell, set `CP_EMAIL` using its normal input command. Use the address already allowed by the existing Access policy. Never put a password in the command line or shell history.

3. Apply both pending migrations to the existing D1. `0001` preserves `kv`; the new `0002` adds only the limiter expiry index:

   ```sh
   npx wrangler@4.152.0 d1 migrations apply custom-pomodoro-sync --remote --config deploy/wrangler.local.jsonc
   ```

4. Set the first password. Run this from a terminal, type the password and press Enter. Input does not echo. The script's stdout contains exactly one SQL statement; the password is not included:

   ```sh
   node scripts/set-password.mjs "$CP_EMAIL" | (
     IFS= read -r cp_sql || exit 1
     npx wrangler@4.152.0 d1 execute custom-pomodoro-sync --remote --config deploy/wrangler.local.jsonc --command "$cp_sql"
   )
   ```

   For noninteractive use only, the script also accepts `CP_PASSWORD` from the environment or reads stdin. Keep it out of logs. This provisioning command is for the first password; use the reset page for later changes so existing sessions are revoked.

5. Build and deploy the reviewed Worker with the allowed address supplied explicitly:

   ```sh
   npm run build
   npx wrangler@4.152.0 deploy --config deploy/wrangler.local.jsonc --var "ALLOWED_EMAILS:$CP_EMAIL"
   ```

   Pass that override on each later deployment too, or manage the variable through an untracked deployment configuration. The checked-in empty value must not overwrite the live allowlist. Keep the existing `TEAM_DOMAIN`, `POLICY_AUD` and D1 binding.

6. After deployment, narrow the existing Cloudflare Access application's public hostname path from the whole dashboard to `/account/reset*`. Keep the existing allowed-email policy and One-time PIN login method. Make sure no second wildcard Access application still covers `/` or `/api/*`. Do not remove Access from the reset path.

7. Check signed-out dashboard use, email/password login, first-device Keep and Replace using disposable profiles, and web-to-Mac sync in both directions. Check Forgot password in the Mac app opens the system browser, the email PIN arrives, reset signs out every device, and the new password works. Rebuild/package the Mac app from the same reviewed source through the lead's release workflow; this job does not install it.

If rolling back the Worker, restore the matching Access application scope too. The added account tables can remain while the old Worker runs; do not drop `kv` or delete account data as a rollback shortcut.

## Files changed

The Worker changes are in `worker/index.ts`, the shared password helper and its declarations, `worker/index.test.ts`, `worker/provision.test.ts`, this document, `deploy/wrangler.jsonc`, the new migration, provisioning/benchmark/local-test scripts and the reset page assets. Desktop changes are in `main.cjs`, `preload.cjs`, the new `cloud.cjs` and their tests. Shared UI/transport changes are in `src/lib/sync.ts`, `src/desktop.d.ts`, `DataTab.tsx` and their tests. `docs/PARITY.md` records the new behavior.

Three small integration additions outside the job's named files were needed: `App.tsx` adds the dashboard sign-in chip, `SettingsDrawer.tsx` accepts an optional initial tab so that chip opens Your data without changing saved preferences, and `store.ts` exports defaults and a sync apply helper so lazy stores and missing account values restore correctly. Existing unrelated work was preserved. No dependency was added.

## Iteration change (lead, 24 Oct 2026)

Whole-request login CPU under local workerd was 8.96 ms median and 10.38 ms p95 at 60,000 iterations, right at the Free plan's 10 ms limit. The count is now **40,000** (`worker/password.mjs`), which removes roughly 1.5 ms of hashing per login. The 5-per-15-minute limit and a long random password carry most of the protection. Iterations are stored per user, so a later raise only needs a password reset.
