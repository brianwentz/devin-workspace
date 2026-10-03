import { clipboard, Menu } from 'electron';
import { log } from './log';
import { state } from './state';

// No application menu means no default editing context menu either — the shell
// gets one built from the Chromium context-menu params. Never log text.
export function attachContextMenu(webContents: Electron.WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      const flags = params.editFlags;
      items.push(
        { role: 'undo', enabled: flags.canUndo },
        { role: 'redo', enabled: flags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: flags.canCut },
        { role: 'copy', enabled: flags.canCopy },
        { role: 'paste', enabled: flags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: flags.canSelectAll },
      );
    } else if (params.selectionText) {
      items.push({ role: 'copy' });
    }
    if (params.linkURL) {
      if (items.length > 0) items.push({ type: 'separator' });
      items.push({
        label: 'Copy link address',
        click: () => clipboard.writeText(params.linkURL),
      });
    }
    if (items.length === 0) return;
    log('shell', 'context-menu', {
      detail: {
        editable: params.isEditable,
        hasSelection: params.selectionText.length > 0,
        hasLink: params.linkURL.length > 0,
      },
    });
    const menu = Menu.buildFromTemplate(items);
    if (state.windowRef) menu.popup({ window: state.windowRef });
    else menu.popup();
  });
}
