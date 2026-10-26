const TIMER_COMMANDS = Object.freeze(['toggle', 'pause', 'skip', 'reset', 'stop', 'stopSound', 'stopAndPause', 'beginEndHold', 'cancelEndHold']);
const validTimerCommand = value => typeof value === 'string' ? TIMER_COMMANDS.includes(value) : !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 && value.action === 'endHardSession' && typeof value.reason === 'string' && value.reason.length <= 500;
const refusal = reason => ({ ok: false, reason });

/** The authoritative renderer executes timerActions and returns its typed result. */
function createTimerCommands({ send, timeoutMs = 5000 }) {
  let serial = 0;
  const pending = new Map();
  return {
    request(command, origin) {
      if (!validTimerCommand(command)) return Promise.resolve(refusal('invalid-command'));
      const id = ++serial;
      return new Promise(resolve => {
        const timer = setTimeout(() => { pending.delete(id); resolve(refusal('unavailable')); }, timeoutMs);
        timer.unref?.();
        pending.set(id, { resolve, timer });
        if (!send({ id, command, ...(origin ? { origin } : {}) })) { clearTimeout(timer); pending.delete(id); resolve(refusal('unavailable')); }
      });
    },
    reply(id, result) {
      if (!result || (result.ok !== true && !(result.ok === false && ['hard-mode', 'hold-required', 'reason-required', 'stale-segment', 'typing-guard'].includes(result.reason)))) return;
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id); clearTimeout(item.timer); item.resolve(result);
    },
  };
}
module.exports = { TIMER_COMMANDS, validTimerCommand, createTimerCommands };
