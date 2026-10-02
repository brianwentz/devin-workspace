const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async function afterPack(context) {
  const isMac = context.electronPlatformName === 'darwin';
  const productFilename = context.packager.appInfo.productFilename;
  // Fuses are flipped by electron-builder from build.electronFuses (doAddElectronFuses
  // runs after afterPack, right before signing). Flipping them here would invalidate
  // the Electron ad-hoc signature on macOS -> Gatekeeper "application is damaged".
  // Build-time marker read by src/main/updater.ts: electron-updater on darwin
  // throws for unsigned apps, so unsigned Mac builds disable the updater. The
  // file lands inside the .app before signing (afterPack runs before sign).
  const signing = { signed: isMac ? Boolean(process.env.CSC_LINK) : false };
  writeFileSync(
    join(
      context.appOutDir,
      isMac
        ? `${productFilename}.app/Contents/Resources/signing.json`
        : join('resources', 'signing.json'),
    ),
    JSON.stringify(signing),
  );
};
