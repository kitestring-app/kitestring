const form = document.querySelector('#reset');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.querySelector('#message');
  const password = form.elements.password.value;
  const confirm = form.elements.confirm.value;
  if (password.length < 12 || password !== confirm) { message.textContent = 'Use at least 12 characters and make both passwords match.'; return; }
  form.querySelector('button').disabled = true;
  try {
    const response = await fetch('/account/reset/', { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Custom-Pomodoro': '1' }, body: JSON.stringify({ password, confirm }) });
    const data = await response.json();
    message.textContent = response.ok ? 'Password saved. Sign in again on each device.' : data.error || 'Could not save your password. Try again.';
    if (response.ok) form.reset();
  } catch { message.textContent = 'Could not save your password. Reload to verify your email and try again.'; }
  finally { form.querySelector('button').disabled = false; }
});
