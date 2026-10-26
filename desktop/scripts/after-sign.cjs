const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async ({ appOutDir, packager, electronPlatformName }) => {
  if (electronPlatformName !== 'darwin') return;
  const bundle = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  // A stable identity keeps macOS Keychain "Always Allow", notification and login-item approvals across rebuilds.
  // CP_SIGN_IDENTITY is a local certificate hash (set by scripts/install-latest.sh); without it, sign ad hoc.
  const identity = process.env.CP_SIGN_IDENTITY || '-';
  execFileSync('codesign', ['--force', '--deep', '--sign', identity, '--identifier', packager.appInfo.id, bundle], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
};
