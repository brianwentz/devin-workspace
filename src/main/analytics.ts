import { WebContentsView } from 'electron';
import { analyticsUrl } from '../core/sessions';
import { log } from './log';
import { attachRouting } from './routing';
import { state } from './state';

// The Analytics surface is a hosted view on the tenant partition, created on
// first use (it stays alive after leaving the surface — no teardown on switch).
// No preload: it shares `persist:devin` but never talks autofill IPC.
export function ensureAnalyticsView(): WebContentsView {
  if (state.analyticsView) return state.analyticsView;
  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:devin',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  state.analyticsView = view;
  view.setBackgroundColor('#111827');
  attachRouting(view.webContents, 'analytics');
  const url = analyticsUrl(state.tenantUrl);
  view.webContents.loadURL(url).catch((error: unknown) => {
    log('analytics', 'load-error', { url, detail: { message: String(error) } });
  });
  log('analytics', 'analytics-view-created', { url });
  return view;
}
