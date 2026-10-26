import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../../lib/sync';
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useSyncExternalStore: (_: unknown, get: () => unknown) => get() }));
const state = vi.hoisted(() => ({ current: { state: 'signedOut' } as SyncStatus }));
vi.mock('../../lib/sync', () => ({ syncStatus: { subscribe: () => () => {}, get: () => state.current }, syncNow: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), chooseInitialData: vi.fn(), openPasswordReset: vi.fn(), metaAfterImport: vi.fn() }));
import { DataTab } from './DataTab';
beforeEach(() => { state.current = { state: 'signedOut' }; });
it('offers labelled sign-in and recovery without signup', () => {
  const html = renderToStaticMarkup(<DataTab />);
  for (const part of ['type="email"', 'type="password"', 'autoComplete="current-password"', 'Sign in', 'Forgot password?']) expect(html).toContain(part);
  expect(html).not.toContain('Sign up');
});
it('shows sync time, account and sign-out when signed in', () => {
  state.current = { state: 'ok', email: 'test@example.invalid', at: Date.now() };
  const html = renderToStaticMarkup(<DataTab />);
  for (const part of ['Synced to test@example.invalid', 'last sync', 'Sync now', 'Sign out']) expect(html).toContain(part);
  expect(html).not.toContain('type="password"');
});
it('asks for a data choice before first pull, and shows plain rate-limit errors', () => {
  state.current = { state: 'choice', email: 'test@example.invalid', error: 'Too many sign-in attempts. Try again later.' };
  const html = renderToStaticMarkup(<DataTab />);
  for (const part of ["Keep this device&#x27;s data", "Replace with account&#x27;s data", 'Too many sign-in attempts', 'role="alert"']) expect(html).toContain(part);
  expect(html).not.toContain('>Sync now<');
});
it('describes the localhost copy without offering a login there', () => {
  state.current = { state: 'off' };
  const html = renderToStaticMarkup(<DataTab />);
  expect(html).toContain('localhost companion'); expect(html).not.toContain('type="password"');
});
