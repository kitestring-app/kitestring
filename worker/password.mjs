// Shared by the Worker and the offline provisioning tool. No credentials are logged.
export const ITERATIONS = 40000; // fits the Free-plan 10 ms CPU limit with headroom (see AUTH.md); stored per user, so it can be raised later
export const hex = (bytes) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export async function hashPassword(password, salt = hex(crypto.getRandomValues(new Uint8Array(16))), iterations = ITERATIONS) {
  if (!/^[a-f0-9]{32}$/.test(salt) || !Number.isInteger(iterations) || iterations < 1 || iterations > 100000) throw new Error('Invalid hash parameters');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = Uint8Array.from(salt.match(/../g), h => parseInt(h, 16));
  const pw_hash = hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes, iterations }, key, 256));
  return { pw_hash, salt, iterations };
}
export function constantEqual(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export async function verifyPassword(password, user) {
  return constantEqual((await hashPassword(password, user.salt, user.iterations)).pw_hash, user.pw_hash);
}
