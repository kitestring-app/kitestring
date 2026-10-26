const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initialAttention, decideAttention } = require('../attention.cjs');
const request = (state, now, kind = 'focus-done') => decideAttention(state, { type: 'attention', kind, now });

test('accepts only valid attention kinds and finite times', () => {
  const initial = initialAttention();
  for (const kind of ['bogus', '', null, {}, undefined]) assert.equal(decideAttention(initial, { type: 'attention', kind, now: 0 }), initial);
  for (const now of [NaN, Infinity, undefined]) assert.equal(request(initial, now), initial);
  assert.equal(request(initial, 0).releaseAt, 120000);
});

test('re-raises active attention and refreshes the hold after the minimum interval', () => {
  const active = request(initialAttention(), 0);
  for (const now of [3000, 44999]) assert.equal(request(active, now, 'break-over'), active);
  const refreshed = request(active, 45000, 'break-over');
  assert.notEqual(refreshed, active); // main.cjs raises the window on each accepted state change
  assert.deepEqual(refreshed, { lastAcceptedAt: 45000, releaseAt: 165000 });
  assert.equal(decideAttention(refreshed, { type: 'timeout', now: 120000 }), refreshed);
  const next = request(refreshed, 105000);
  assert.deepEqual(next, { lastAcceptedAt: 105000, releaseAt: 225000 });
  assert.equal(decideAttention(next, { type: 'timeout', now: 224999 }), next);
  assert.equal(decideAttention(next, { type: 'timeout', now: 225000 }).releaseAt, null);
  assert.equal(decideAttention(next, { type: 'hide' }).releaseAt, null);
  assert.equal(decideAttention(next, { type: 'release' }).releaseAt, null);
  assert.equal(request(next, 165000, 'invalid'), next);
});

test('release and hide preserve a full forty-five-second minimum between accepted requests', () => {
  const active = request(initialAttention(), 100, 'break-over');
  for (const type of ['release', 'hide']) {
    const released = decideAttention(active, { type, now: 200 });
    assert.equal(released.releaseAt, null);
    assert.equal(released.lastAcceptedAt, 100);
    for (const now of [300, 3100, 45099]) assert.equal(request(released, now), released);
    assert.equal(request(released, 45100).releaseAt, 165100);
    assert.equal(decideAttention(released, { type, now: 400 }), released);
  }
});

test('expires after two minutes and ignores an old timeout after a new request', () => {
  const first = request(initialAttention(), 0);
  assert.equal(decideAttention(first, { type: 'timeout', now: 119999 }), first);
  const expired = decideAttention(first, { type: 'timeout', now: 120000 });
  assert.equal(expired.releaseAt, null);
  const next = request(expired, 120000, 'break-over');
  assert.equal(next.releaseAt, 240000);
  assert.equal(decideAttention(next, { type: 'timeout', now: 120000 }), next);
  assert.equal(decideAttention(next, { type: 'timeout', now: 240000 }).releaseAt, null);
});
