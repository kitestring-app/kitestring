// Wait for the renderer's IndexedDB transaction, but never trap Quit on a hung page.
function createQuitGuard({ requestFlush, finish, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let state = 'idle';
  let timeout;
  let request = 0;
  function complete() {
    if (state !== 'waiting') return;
    clearTimer(timeout); state = 'done'; finish();
  }
  return {
    beforeQuit(event) {
      if (state === 'done') return;
      event.preventDefault();
      if (state === 'waiting') return;
      state = 'waiting'; request++;
      timeout = setTimer(complete, 2000);
      requestFlush(request);
    },
    acknowledge(id) { if (id === request) complete(); },
  };
}
module.exports = { createQuitGuard };
