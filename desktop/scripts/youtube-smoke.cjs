// Live, opt-in check. Install with scripts/install-latest.sh first, then launch
// that app (or your own disposable Chrome) with a loopback debugging port.
// Never point this at a personal Chrome profile. No credentials or media URLs
// are recorded; the evidence is player state and an advancing playback clock.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { connect, waitFor } = require('./cdp.cjs');

async function checkPlayback({ port, stationIds, url } = {}) {
  assert.ok(Number.isInteger(port) && port > 0, 'Pass --port for the app or throwaway browser you launched');
  const list = () => fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  const page = (await list()).find(p => p.type === 'page' && (!url || p.url === url) && (
    p.url === 'app://custom-pomodoro/' || /^http:\/\/(localhost|127\.0\.0\.1):4747\/?$/.test(p.url)
    || p.url === 'https://kitestring.custom-pomodoro.workers.dev/'));
  assert.ok(page, 'Expected the Kitestring dashboard');
  const cdp = await connect(page.webSocketDebuggerUrl);
  const evaluate = async (client, expression) => {
    const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    assert.equal(r.exceptionDetails, undefined, 'The playback probe must evaluate successfully');
    return r.result.value;
  };
  const source = readFileSync(path.join(__dirname, '../../src/data/stations.ts'), 'utf8');
  const stations = vm.runInNewContext(stripTypeScriptTypes(source).replace(/export /g, '') + '; STATIONS.map(s => ({id:s.id,name:s.name,url:stationEmbed(s)}))');
  const results = [];
  try {
    await evaluate(cdp, `if (document.querySelector('.sounds-panel').hidden) document.querySelector('button[aria-label="Sounds & music (M)"]').click()`);
    await evaluate(cdp, `document.querySelector('.sounds-player button')?.click()`);
    await evaluate(cdp, `[...document.querySelectorAll('.sounds-panel button')].find(b => b.textContent === 'Stations').click()`);
    for (const station of stations.filter(s => !stationIds || stationIds.includes(s.id))) {
      let player;
      try {
        await evaluate(cdp, `[...document.querySelectorAll('.sounds-station')].find(b => b.querySelector('b').textContent === ${JSON.stringify(station.name)}).click(); document.querySelector('.sounds-player').scrollIntoView({block:'center'})`);
        const target = await waitFor(`${station.name} iframe`, async () => (await list()).find(p => p.type === 'iframe' && p.url === station.url), { timeoutMs: 30000 });
        player = await connect(target.webSocketDebuggerUrl);
        await player.send('Runtime.enable');
        await player.send('Runtime.runIfWaitingForDebugger');
        const sample = () => evaluate(player, `(() => { const v = document.querySelector('video'); return { state: document.querySelector('#movie_player')?.getPlayerState?.(), time: v?.currentTime ?? 0, paused: v?.paused ?? true, ready: v?.readyState ?? 0, error: document.querySelector('.ytp-error-content-wrap')?.innerText?.slice(0,240) || null }; })()`);
        let last;
        const first = await waitFor(`${station.name} playing (state 1, decoded media)`, async () => {
          last = await sample();
          if (last.error) return last;
          return last.state === 1 && !last.paused && last.ready >= 2 ? last : false;
        }, { timeoutMs: 45000, intervalMs: 500 }).catch(error => { throw new Error(`${error.message}; last state ${JSON.stringify(last)}`); });
        assert.equal(first.error, null, `${station.name}: ${first.error}`);
        await delay(2200);
        const second = await sample();
        assert.equal(second.state, 1, `${station.name} must stay playing`);
        assert.equal(second.paused, false);
        assert.ok(second.time - first.time > 1, `${station.name} playback clock must advance by more than one second`);
        const result = { station: station.name, pass: true, first, second };
        results.push(result); console.log(JSON.stringify(result));
      } catch (error) {
        const result = { station: station.name, pass: false, error: error.message };
        results.push(result); console.log(JSON.stringify(result));
      } finally { player?.socket.close(); }
    }
    await evaluate(cdp, `document.querySelector('.sounds-player button')?.click()`);
  } finally { cdp.socket.close(); }
  assert.ok(results.length > 0 && results.every(r => r.pass), 'Every selected station must actually play');
  return results;
}
module.exports = { checkPlayback };
if (require.main === module) {
  const portAt = process.argv.indexOf('--port'), urlAt = process.argv.indexOf('--url');
  checkPlayback({ port: portAt < 0 ? undefined : Number(process.argv[portAt + 1]),
    url: urlAt < 0 ? undefined : process.argv[urlAt + 1],
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
