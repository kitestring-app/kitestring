const breakOver = new URLSearchParams(location.search).get('kind') === 'break-over';
document.getElementById('label').textContent = breakOver ? 'Break over' : 'Focus complete';
document.getElementById('continue').textContent = breakOver ? 'Continue' : 'Take a break';
for (const action of ['continue', 'stop', 'open', 'dismiss']) {
  document.getElementById(action).addEventListener('click', () => window.banner?.open(action));
}
