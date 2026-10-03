import { parseSessionId } from '../core/sessions';
import { GLOBAL } from '../core/tabModel';
import { log } from './log';
import { notifier } from './notifier';
import { state } from './state';
import { notifyShell } from './window';

export function attachSessionTracking(devinView: Electron.WebContents): void {
  const update = (url: string) => {
    const sessionId = parseSessionId(url, state.tenantUrl);
    if (sessionId === state.currentSessionId) return;
    state.currentSessionId = sessionId;
    // Swap the visible GitHub tab scope BEFORE notifyShell/applyLayout run —
    // they read tabManager.activeView/publicState.
    state.tabManager?.setScope(sessionId ?? GLOBAL);
    log('devin', 'session-change', { url, detail: { sessionId } });
    notifyShell();
    // Service-user identity inference observes the sessions the user opens.
    notifier.onSessionChanged(sessionId);
  };
  devinView.on('did-navigate', (_event, url) => update(url));
  devinView.on('did-navigate-in-page', (_event, url) => update(url));
}
