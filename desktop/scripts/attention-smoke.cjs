// Native visibility also reflects macOS occlusion; first paint + show is the readiness invariant.
// A display can disconnect between reminders. A single display correctly has no banner.
function bannersReady(state) {
  return state.attentionActive && state.banners.length === state.displayCount - 1 &&
    state.banners.every(banner => banner.shown);
}
module.exports = { bannersReady };
