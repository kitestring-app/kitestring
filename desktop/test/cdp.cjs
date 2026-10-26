const { test } = require('node:test');
const assert = require('node:assert/strict');
const { connect, waitFor } = require('../scripts/cdp.cjs');

class Socket extends EventTarget {
  constructor() { super(); Socket.last = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
  send(message) { this.lastCommand = JSON.parse(message); }
  reply(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
  close() { this.dispatchEvent(new Event('close')); }
}

test('debug commands retain load events and resolve their matching response', async () => {
  const cdp = await connect('ws://test', { Socket });
  const result = cdp.send('Page.enable');
  Socket.last.reply({ method: 'Page.loadEventFired', params: { timestamp: 1 } });
  Socket.last.reply({ id: Socket.last.lastCommand.id, result: { ready: true } });
  assert.deepEqual(await result, { ready: true });
  assert.equal(cdp.events[0].method, 'Page.loadEventFired');
  cdp.socket.close();
});

test('debug command errors and timeouts name the command and reject cleanly', async () => {
  const cdp = await connect('ws://test', { Socket });
  const failed = cdp.send('Page.enable');
  Socket.last.reply({ id: Socket.last.lastCommand.id, error: { message: 'unavailable' } });
  await assert.rejects(failed, /Page.enable: unavailable/);
  await assert.rejects(cdp.send('Runtime.evaluate', { expression: 'document.readyState' }, 5), /Runtime.evaluate.*document.readyState/);
  const interrupted = cdp.send('Runtime.enable');
  cdp.socket.close();
  await assert.rejects(interrupted, /socket closed/);
});

test('readiness polling retries transient errors and reports the last failure', async () => {
  let attempts = 0;
  assert.equal(await waitFor('Page load', () => {
    if (++attempts === 1) throw new Error('context not created yet');
    return attempts === 3 && 'ready';
  }, { timeoutMs: 100, intervalMs: 1 }), 'ready');
  await assert.rejects(waitFor('Page load', () => { throw new Error('renderer exited'); }, { timeoutMs: 5, intervalMs: 1 }), /Page load.*renderer exited/);
});

test('readiness deadlines survive a wall-clock jump during the cooldown', async () => {
  const wallNow = Date.now;
  let wall = 1000, probes = 0;
  Date.now = () => (wall += 60000);
  try {
    assert.equal(await waitFor('Native cooldown', () => ++probes === 3 && 'ready',
      { timeoutMs: 50, intervalMs: 1 }), 'ready');
  } finally { Date.now = wallNow; }
});
