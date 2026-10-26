const { setTimeout: delay } = require('node:timers/promises');

async function connect(url, { timeoutMs = 20000, Socket = WebSocket } = {}) {
  const socket = new Socket(url);
  const pending = new Map();
  const events = [];
  let nextId = 0;
  let opened;
  let failed;
  let openTimer;
  const ready = new Promise((resolve, reject) => {
    opened = resolve;
    failed = reject;
    openTimer = setTimeout(() => reject(new Error('The packaged app debug socket did not open within 20 seconds')), timeoutMs);
  });
  const rejectPending = (reason) => {
    failed(reason);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(reason); }
    pending.clear();
  };
  socket.addEventListener('open', () => { clearTimeout(openTimer); opened(); });
  socket.addEventListener('error', (event) => rejectPending(new Error(`The packaged app debug socket failed: ${event.message || event.error?.message || 'connection error'}`)));
  socket.addEventListener('close', (event) => rejectPending(new Error(`The packaged app debug socket closed (${event.code ?? 'no code'}: ${event.reason || 'no reason'})`)));
  socket.addEventListener('message', ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.method) {
      events.push(message);
      if (events.length > 500) events.shift();
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
    else entry.resolve(message.result);
  });
  try { await ready; } catch (error) { socket.close(); throw error; } finally { clearTimeout(openTimer); }
  return {
    socket, events,
    send(method, params = {}, commandTimeoutMs = timeoutMs) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} did not answer within ${commandTimeoutMs / 1000} seconds${params.expression ? ` (${params.expression.slice(0, 100)})` : ''}`));
        }, commandTimeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
  };
}

async function waitFor(label, probe, { timeoutMs = 60000, intervalMs = 200 } = {}) {
  const deadline = performance.now() + timeoutMs;
  let lastError;
  do {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) { lastError = error; }
    await delay(intervalMs);
  } while (performance.now() < deadline);
  throw new Error(`${label} was not ready within ${timeoutMs / 1000} seconds${lastError ? `: ${lastError.message}` : ''}`);
}
module.exports = { connect, waitFor };
