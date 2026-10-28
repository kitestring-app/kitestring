# Full-screen attention evidence and device check

Observed in Electron 45.0.0: `desktop/node_modules/electron/package.json`,
`electron.d.ts` (`BrowserWindowConstructorOptions.type`,
`setAlwaysOnTop`, `VisibleOnAllWorkspacesOptions`) and `index.js` were inspected.
The npm distribution ships declarations and a binary installer, not native source.
The matching upstream source and docs establish the native implementation:

- [Window types](https://github.com/electron/electron/blob/v45.0.0/docs/api/structures/base-window-options.md#window-types): panel windows can float over full-screen apps.
- [ElectronNSPanel](https://github.com/electron/electron/blob/v45.0.0/shell/browser/ui/cocoa/electron_ns_panel.mm): adds the nonactivating panel mask and always joins Spaces with FullScreenAuxiliary.
- [NativeWindowMac](https://github.com/electron/electron/blob/v45.0.0/shell/browser/native_window_mac.mm): ShowInactive orders front without activation; Show and Focus can take the keyboard. Screen-saver maps to NSScreenSaverWindowLevel. SetVisibleOnAllWorkspaces sets collection flags; skipping process transformation avoids DockHide/DockShow, but cannot make an ordinary NSWindow a panel.
- [BaseWindow docs](https://github.com/electron/electron/blob/v45.0.0/docs/api/base-window.md): process transformations briefly hide windows and Dock. Explicit Show temporarily joins Spaces, then resets after 250 ms unless active attention still requires it.

Verified with Electron stubs: one panel per display, correct native options before
showInactive, no panel focus/show calls, immediate panels during dashboard
full-screen exit, trusted pointer actions bound to the settled segment, correct break recovery with takeover off, refusal/replacement safety, display
removal, release/hide/timeout and teardown. The original regression test failed
because the main display received no banner. Shared alert typing protection and
Calm/bring-to-front settings remain on their existing paths. Web never creates
these native windows. An additive `answerAttention` bridge command and renderer export check segment identity before acting. No runtime dependency or network request was added.

Not verified: native presentation over actual full-screen Spaces, Dock continuity,
system Focus / Do Not Disturb, physical input focus or audio. Electron exposes no
public Focus-status API here; custom panels are not system notifications and
system Focus suppression must not be assumed. This change preserves the existing
attention opt-in; it does not add a new system Focus integration.

## Manual device check, after the user authorizes installation

1. Build the current Mac app and install using `scripts/install-latest.sh`.
   Do not test an older installed copy. Connect the external monitor and enable
   separate Spaces for displays in macOS. Put a different app in native full
   screen on each display using its green window button.
2. In Kitestring enable Bring to front, choose a short focus block, start it,
   then hide or minimize Kitestring. Type continuously in the other app across
   the deadline. Expect a panel on **both** displays without switching Spaces;
   typing must stay in the original app and must not answer the alert.
3. Click Continue at focus end, then repeat at break end. Verify each starts
   the expected segment once; with auto-run on it must not pause the segment.
   In single-session Countdown with takeover on, Continue starts another focus
   session. The mode-neutral label does not promise a break.
   Verify Stop, Dismiss and Open on each display, including Hard mode refusal.
   Open must focus the dashboard on the clicked display and dismiss all panels.
4. Repeat with one monitor, dashboard already in native full screen, desktop apps
   rather than full screen, unplugging a display during the reminder, and no
   interaction for two minutes. No stale panels or permanent screen obstruction
   may remain. Use tray Show Kitestring and Window > Bring All to Front from a
   different Space; verify the dashboard is reachable and workspace state resets.
5. Disable Bring to front / use Calm and confirm no automatic panels. Repeat with
   macOS Focus / Do Not Disturb on and off and record actual suppression behavior.
   Also check any parking review opened through the dashboard on return. None of
   these device checks has been run for this job.
