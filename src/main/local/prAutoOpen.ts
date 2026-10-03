import { route } from '../../core/linkRouter';
import { localScope } from '../../core/tabModel';
import { log } from '../log';
import { routeContext } from '../routing';
import { state } from '../state';
import { applyLayout } from '../window';

// Local counterpart of the notifier's `pr-auto-open`: a GitHub PR URL that
// shows up in agent output opens a lazy background tab in `local:<sessionId>`.
export function autoOpenLocalPr(
  url: string,
  sessionId: string,
  source: 'local-chat' | 'local-terminal',
): boolean {
  if (!(state.settings?.current.prs.autoOpenTabs ?? true)) return false;
  if (route(url, 'local', 'new-window', routeContext()).kind !== 'gh-tab') return false;
  const tabManager = state.tabManager;
  if (!tabManager) return false;
  tabManager.open(url, {
    lazy: true,
    background: true,
    originSessionId: localScope(sessionId),
  });
  applyLayout();
  log('local', 'pr-auto-open', { url, detail: { sessionId, source } });
  return true;
}
