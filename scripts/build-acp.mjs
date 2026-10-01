import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('out/scripts', { recursive: true });
await Promise.all(
  ['acp-probe', 'acp-contract'].map((name) =>
    build({
      entryPoints: [`scripts/${name}.ts`],
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      outfile: `out/scripts/${name}.cjs`,
      sourcemap: true,
    }),
  ),
);
