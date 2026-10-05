import { parseSessionId } from '../core/sessions';
import { cloudSessions } from './cloudSessions';
import { log } from './log';
import { notifier } from './notifier';
import { state } from './state';
import { applyLayout } from './window';

export function attachSessionTracking(devinView: Electron.WebContents): void {
  const update = (url: string) => {
    const sessionId = parseSessionId(url, state.tenantUrl);
    if (sessionId === state.currentSessionId) return;
    state.currentSessionId = sessionId;
    // The layout pass swaps the GitHub tab scope, sizes/attaches the active
    // tab view and notifies the shell — it reads tabManager.activeView/publicState.
    applyLayout();
    log('devin', 'session-change', { url, detail: { sessionId } });
    // Service-user identity inference observes the sessions the user opens.
    notifier.onSessionChanged(sessionId);
    cloudSessions().refresh('session-change');
  };
  devinView.on('did-navigate', (_event, url) => update(url));
  devinView.on('did-navigate-in-page', (_event, url) => update(url));
}
