const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async function afterPack(context) {
  const isMac = context.electronPlatformName === 'darwin';
  const productFilename = context.packager.appInfo.productFilename;
  const executable = join(
    context.appOutDir,
    isMac ? `${productFilename}.app` : `${productFilename}.exe`,
  );
  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
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
