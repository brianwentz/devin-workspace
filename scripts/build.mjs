import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { build as viteBuild } from 'vite';

await mkdir('out', { recursive: true });
await mkdir('out/scripts', { recursive: true });
await mkdir('out/fixtures', { recursive: true });

await Promise.all([
  build({
    entryPoints: ['src/main/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    // node-pty is a native addon loaded from node_modules (asarUnpacked).
    external: ['electron', 'node-pty'],
    outfile: 'out/main.cjs',
    sourcemap: true,
  }),
  build({
    entryPoints: ['src/shell/preload.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
    outfile: 'out/preload.cjs',
  }),
  build({
    entryPoints: ['scripts/os-input.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron', 'playwright'],
    outfile: 'out/scripts/os-input.cjs',
  }),
  // Fake ACP v1 agent used by the Local E2E tests (DEVIN_WORKSPACES_LOCAL_AGENT_CMD).
  build({
    entryPoints: ['tests/fixtures/fakeAcpAgent.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: 'out/fixtures/fakeAcpAgent.cjs',
  }),
  // Echo pty used by the Terminal E2E (DEVIN_WORKSPACES_TEST_TERMINAL_CMD).
  build({
    entryPoints: ['tests/fixtures/fakePty.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: 'out/fixtures/fakePty.cjs',
  }),
  build({
    entryPoints: ['scripts/measure-tabs.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron', 'playwright'],
    outfile: 'out/scripts/measure-tabs.cjs',
  }),
]);

await viteBuild({ configFile: 'vite.config.mts' });
