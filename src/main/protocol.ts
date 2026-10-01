import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, net, protocol } from 'electron';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function getShellAssetPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'app:' || parsed.hostname !== 'shell') return null;
    const relative = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
    const root = resolve(app.getAppPath(), 'out', 'shell');
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(`${root}${sep}`) && filePath !== root) return null;
    return filePath;
  } catch {
    return null;
  }
}

export function installProtocol(): void {
  protocol.handle('app', (request) => {
    const filePath = getShellAssetPath(request.url);
    if (!filePath || extname(filePath) === '') return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
