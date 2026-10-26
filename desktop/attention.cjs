// Pure policy: the main process owns the native window and schedules deadlines.
const RATE_LIMIT_MS = 45000;
const RELEASE_AFTER_MS = 120000;
const initialAttention = () => ({ lastAcceptedAt: null, releaseAt: null });

function decideAttention(state, event) {
  if (event.type === 'attention') {
    if (!['focus-done', 'break-over'].includes(event.kind) || !Number.isFinite(event.now)) return state;
    if (state.lastAcceptedAt !== null && event.now - state.lastAcceptedAt < RATE_LIMIT_MS) return state;
    return { lastAcceptedAt: event.now, releaseAt: event.now + RELEASE_AFTER_MS };
  }
  if (state.releaseAt === null) return state;
  if (event.type === 'release' || event.type === 'hide' || (event.type === 'timeout' && event.now >= state.releaseAt)) {
    return { ...state, releaseAt: null };
  }
  return state;
}
module.exports = { initialAttention, decideAttention, RATE_LIMIT_MS };
