const input = document.querySelector('input');
document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!input.value.trim() || input.disabled) return;
  input.disabled = true;
  try { if (!await window.parking.save(input.value)) { input.disabled = false; input.focus(); } }
  catch { input.disabled = false; input.focus(); }
});
input.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); window.parking.close(); }
  if (event.key === 'Enter' && event.isComposing) event.preventDefault();
});
window.addEventListener('focus', () => input.focus());
