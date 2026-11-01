const breakOver = new URLSearchParams(location.search).get('kind') === 'break-over';
document.getElementById('label').textContent = breakOver ? 'Break over' : 'Focus complete';
// Each kind has its own colour so a Break over bar replacing a Focus complete bar is visible at a glance.
document.body.classList.add(breakOver ? 'break-over' : 'focus-done');
document.getElementById('continue').textContent = 'Continue';
for (const action of ['continue', 'stop', 'open', 'dismiss']) {
  document.getElementById(action).addEventListener('click', () => window.banner?.open(action));
}
