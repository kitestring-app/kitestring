const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTimerCommands, validTimerCommand } = require('../timer-commands.cjs');
const { timerMenuItems, applicationMenu } = require('../menu.cjs');
test('attention commands require an exact segment identity and allowlisted action', () => {
  for (const choice of ['continue', 'stop', 'dismiss']) assert.equal(validTimerCommand({ action: 'answerAttention', segId: 'next-break', choice }), true);
  for (const value of [{ action: 'answerAttention', choice: 'stop' },
    { action: 'answerAttention', segId: '', choice: 'stop' },
    { action: 'answerAttention', segId: 's', choice: 'skip' },
    { action: 'answerAttention', segId: 's', choice: 'stop', bypass: true }]) assert.equal(validTimerCommand(value), false);
});
test('all native timer requests return the authoritative typed hard-mode refusal', async () => {
  const sent = [];
  const commands = createTimerCommands({ send: payload => { sent.push(payload); return true; } });
  for (const command of ['pause', 'toggle', 'skip', 'reset', 'stop', 'stopAndPause']) {
    const result = commands.request(command), request = sent.at(-1);
    commands.reply(request.id, { ok: false, reason: 'hard-mode', message: 'Hard mode: this block runs to the end' });
    assert.deepEqual(await result, { ok: false, reason: 'hard-mode', message: 'Hard mode: this block runs to the end' });
  }
  const stopped = commands.request('stopSound'); commands.reply(sent.at(-1).id, { ok: true }); assert.deepEqual(await stopped, { ok: true });
});
test('invalid requests and unavailable renderers resolve without throwing', async () => {
  const commands = createTimerCommands({ send: () => false });
  assert.deepEqual(await commands.request('stop'), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await commands.request('quit'), { ok: false, reason: 'invalid-command' });
  assert.equal(validTimerCommand({ action: 'endHardSession', reason: 'Meeting' }), true);
  assert.equal(validTimerCommand({ action: 'endHardSession', reason: 'Meeting', bypass: true }), false);
});
test('menu input origin survives timer transport and typing refusals resolve immediately', async () => {
  let sent;
  const commands = createTimerCommands({ send: payload => { sent = payload; return true; } });
  const result = commands.request('toggle', 'accelerator');
  assert.equal(sent.origin, 'accelerator');
  const refusal = { ok: false, reason: 'typing-guard', message: 'Wait until typing has stopped.' };
  commands.reply(sent.id, refusal);
  assert.deepEqual(await result, refusal);
});
test('every timer menu command distinguishes accelerators from deliberate clicks', () => {
  const calls = [];
  const state = { segment: 'short', running: false, hasProgress: true, ringing: true, sounding: true };
  const menu = applicationMenu({ timerState: state, command: (...args) => calls.push(args),
    floatingControls: { menu: () => [{}], appMenuItem: () => ({}) } });
  const timerItems = menu.find(item => item.label === 'Timer').submenu.filter(item => ['Start Break', 'Resume Break', 'Skip Break', 'Reset', 'Stop Sound', 'Stop and Pause', 'End Break and Stop'].includes(item.label));
  for (const item of timerItems) {
    item.click({}, {}, { triggeredByAccelerator: true });
    assert.equal(calls.at(-1)[1], 'accelerator', item.label);
    item.click({}, {}, { triggeredByAccelerator: false });
    assert.equal(calls.at(-1)[1], 'pointer', item.label);
  }
  for (const item of timerMenuItems(state, (...args) => calls.push(args))) {
    item.click();
    assert.equal(calls.at(-1)[1], 'pointer', item.label);
  }
});
test('locked tray and Timer menus disable destructive actions, keep Stop Sound and open End session', () => {
  const calls = [];
  const state = { segment: 'short', running: true, hasProgress: true, ringing: true, sounding: true, hardLocked: true };
  const items = timerMenuItems(state, command => calls.push(command));
  for (const item of items.filter(item => item.label.startsWith('🔒'))) {
    assert.equal(item.enabled, false); assert.equal(item.toolTip, 'Hard mode: this block runs to the end');
  }
  items.find(item => item.label === 'Stop Sound').click(); items.find(item => item.label === 'End session…').click();
  assert.deepEqual(calls, ['stopSound', 'endSession']);
  const menu = applicationMenu({ timerState: state, command: () => {}, floatingControls: { menu: () => [{}], appMenuItem: () => ({}) } });
  assert.equal(menu.find(item => item.label === 'Timer').submenu.find(item => item.label === '🔒 Reset').enabled, false);
});
