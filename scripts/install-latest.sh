#!/bin/zsh
# Build, install and launch the Mac app, then PROVE the running copy is this build.
# Every hands-on test must start with this script. It exits non-zero on any mismatch.
set -euo pipefail
cd "${0:A:h}/.."
APP="/Applications/Kitestring.app"
OLD_APP="/Applications/Custom Pomodoro.app"
COPIES="[/](Custom Pomodoro|Kitestring)[.]app/Contents/MacOS/(Custom Pomodoro|Kitestring)([[:space:]]|$)"
# Sign with a stable local identity (first "Apple Development" cert) so Keychain approvals survive rebuilds.
export CP_SIGN_IDENTITY="${CP_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | awk '/Apple Development/ {print $2; exit}')}"
echo "Signing identity: ${CP_SIGN_IDENTITY:-ad hoc (no stable identity found)}"
OUT="desktop/out/mac-arm64/Kitestring.app"

echo "1/5 Quitting every running copy (any path)"
pkill -f "$COPIES" 2>/dev/null || true
for i in {1..20}; do pgrep -f "$COPIES" >/dev/null || break; sleep 0.5; done
if pgrep -f "$COPIES" >/dev/null; then echo "FAIL: a copy is still running"; exit 1; fi

if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
  echo "2/5 Building web + DMG from the current tree ($(git rev-parse --short HEAD)$(git diff --quiet || echo '+uncommitted'))"
  (cd desktop && npm run dist >/dev/null)
else
  echo "2/5 SKIP_BUILD=1: using the existing desktop/out build"
fi
codesign --verify --deep --strict "$OUT"

echo "3/5 Installing to /Applications and copying the DMG to ~/Downloads"
rm -rf "$APP"
ditto "$OUT" "$APP"
# Retire the old bundle after the replacement has copied successfully.
if [[ -d "$OLD_APP" ]]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$OLD_APP" >/dev/null 2>&1 || true
  rm -rf "$OLD_APP"
fi
cp "desktop/out/Kitestring-1.0.0-arm64.dmg" ~/Downloads/

echo "4/5 Verifying the installed bytes match this build"
for f in Contents/Resources/app.asar Contents/Resources/web/index.html; do
  a=$(shasum -a 256 "$OUT/$f" | cut -d' ' -f1); b=$(shasum -a 256 "$APP/$f" | cut -d' ' -f1)
  [[ "$a" == "$b" ]] || { echo "FAIL: $f differs between build and install"; exit 1; }
done
want=$(ls dist/assets/index-*.js | xargs -n1 basename | sort | tr '\n' ' ')
have=$(ls "$APP/Contents/Resources/web/assets/" | grep '^index-.*\.js$' | sort | tr '\n' ' ')
[[ "$want" == "$have" ]] || { echo "FAIL: installed web bundle ($have) is not the current dist ($want)"; exit 1; }

echo "5/5 Launching and checking the only running copy is the new one"
# A pinned "Keep in Dock" tile caches the old icon when the app is replaced in
# place. Re-register the bundle and restart the Dock so it reads the new one.
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true
killall Dock >/dev/null 2>&1 || true
started=$(date +%s)
open -a "$APP"
for i in {1..30}; do pgrep -f "^$APP/Contents/MacOS/Kitestring$" >/dev/null && break; sleep 0.5; done
pids=($(pgrep -f "$COPIES" || true))
(( ${#pids} == 1 )) || { echo "FAIL: expected 1 running copy, found ${#pids}"; exit 1; }
running_command=$(ps -o command= -p ${pids[1]})
[[ "$running_command" == "$APP/Contents/MacOS/Kitestring" ]] || { echo "FAIL: running copy is $running_command"; exit 1; }
echo "OK: running PID ${pids[1]} from /Applications, build $(git rev-parse --short HEAD), bundle $have, launched $(date -r $started +%H:%M:%S)"
