import { isGitHubHost } from '../core/linkRouter';
import { log } from './log';
import { fixtureOrigins, originOf, state } from './state';

// F1: GitHub tab views get sanitized clipboard writes (PR copy buttons); the
// Devin view also gets notifications. Everything else is denied. In test mode
// the fixture Git origins count as GitHub hosts.
function isGitOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (isGitHubHost(url.hostname)) return true;
    return fixtureOrigins.includes(url.origin);
  } catch {
    return false;
  }
}

export function setPermissions(
  targetSession: Electron.Session,
  viewName: 'devin' | `gh:${string}`,
): void {
  const isGhTab = viewName.startsWith('gh:');
  const allowed = (permission: string, origin: string): boolean => {
    if (viewName === 'devin') {
      return (
        originOf(origin) === originOf(state.tenantUrl) &&
        (permission === 'notifications' || permission === 'clipboard-sanitized-write')
      );
    }
    if (isGhTab) return permission === 'clipboard-sanitized-write' && isGitOrigin(origin);
    return false;
  };

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = details.requestingUrl || webContents.getURL();
    const grant = allowed(permission, origin);
    callback(grant);
    log(viewName, 'permission-request', {
      url: origin,
      decision: grant ? 'allow' : 'deny',
      detail: { permission },
    });
  });
  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const grant = allowed(permission, requestingOrigin);
    log(viewName, 'permission-check', {
      url: requestingOrigin,
      decision: grant ? 'allow' : 'deny',
      detail: { permission, webContentsId: webContents?.id },
    });
    return grant;
  });
}
