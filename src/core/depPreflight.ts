// Pure check used by scripts/build.mjs: which declared packages are not installed.
export type DepPreflightInput = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export function missingDependencies(pkg: DepPreflightInput, isInstalled: (name: string) => boolean): string[] {
  const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  return [...names].filter((name) => !isInstalled(name)).sort();
}

export function formatMissingDependencies(missing: string[]): string {
  return [
    `Build preflight: ${missing.length} declared ${missing.length === 1 ? 'package is' : 'packages are'} not installed in node_modules:`,
    ...missing.map((name) => `  - ${name}`),
    'node_modules is out of date with package.json - run `npm install` and retry.',
  ].join('\n');
}
