// Private local record of reminder decisions, so a missing bar can be proven or ruled out.
// Holds only times, kinds and outcomes: no task names, notes or account data.
function createAttentionLog({ file, fs, limit = 200, clock = () => new Date() }) {
  let lines = null;
  const load = () => {
    if (lines) return;
    try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-limit); } catch { lines = []; }
  };
  return {
    record(entry) {
      load();
      lines.push(JSON.stringify({ at: clock().toISOString(), ...entry }));
      if (lines.length > limit) lines = lines.slice(-limit);
      try { fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 }); } catch { /* Logging never breaks a reminder. */ }
    },
  };
}
module.exports = { createAttentionLog };
