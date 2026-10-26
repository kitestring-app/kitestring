const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createQuitGuard } = require('../quit.cjs');
function harness() {
  let flush, finished = 0, timer;
  const guard = createQuitGuard({ requestFlush: id => { flush = id; }, finish: () => finished++, setTimer: (fn, delay) => { assert.equal(delay, 2000); timer = fn; return 1; }, clearTimer() {} });
  return { guard, request: () => flush, finished: () => finished, timeout: () => timer() };
}
test('Quit waits for the matching flush acknowledgement once, then permits exit', () => {
  const h = harness(); let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  h.guard.beforeQuit(event); h.guard.beforeQuit(event);
  assert.equal(h.finished(), 0); assert.equal(prevented, 2);
  h.guard.acknowledge(999); assert.equal(h.finished(), 0);
  h.guard.acknowledge(h.request()); assert.equal(h.finished(), 1);
  h.guard.beforeQuit(event); assert.equal(prevented, 2);
  h.timeout(); assert.equal(h.finished(), 1);
});
test('a hung or crashed renderer cannot trap Quit beyond two seconds', () => {
  const h = harness(); h.guard.beforeQuit({ preventDefault() {} }); h.timeout();
  assert.equal(h.finished(), 1);
  h.guard.acknowledge(h.request()); assert.equal(h.finished(), 1);
});
