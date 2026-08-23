'use strict';

// electron-builder afterPack hook: ad-hoc sign the macOS app bundle.
//
// CI has no Apple Developer certificate (unsigned, $0 project), so
// electron-builder skips signing entirely. An UNSIGNED app on Apple Silicon
// fails Gatekeeper with the dead-end "app is damaged" dialog. An AD-HOC
// signed app (codesign -s -) instead gets the normal "unidentified
// developer" flow, which users can approve via right-click > Open or
// System Settings > Privacy & Security > Open Anyway.
//
// This is not a Gatekeeper bypass: the app is still quarantined and the
// user still makes the trust decision. It just replaces a broken dialog
// with the standard one. The real fix remains Apple notarization if the
// project ever takes on the $99/yr developer account.

const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`  • ad-hoc signing ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' });
};
