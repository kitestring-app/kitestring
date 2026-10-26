// Served only after Access verification; never copied into public assets.
export const resetHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset your password · Kitestring</title><link rel="stylesheet" href="/reset.css"><script src="/reset.js" defer></script></head>
<body><main><h1>Set a new password</h1><p>Your email has been verified. This signs out every device. Your synced data stays in your account.</p><form id="reset" method="post"><label>New password<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required></label><label>Confirm password<input name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required></label><button>Set password</button></form><p id="message" role="status" aria-live="polite"></p><a href="/">Return to Kitestring</a></main></body></html>
`;
