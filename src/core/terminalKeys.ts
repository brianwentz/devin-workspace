// Key bindings for the embedded xterm terminal, resolved in pure code so both
// the key handler and tests share one table. Follows the Windows Terminal
// convention: Ctrl+C copies only when there is a selection, otherwise it is a
// plain ^C (SIGINT); Ctrl+V pastes via the app (never forwarded as ^V, which
// PSReadLine handles slowly). On macOS Cmd is the accelerator — Cmd+C/Cmd+V
// copy/paste and plain Ctrl+C/Ctrl+V keep their terminal meaning (SIGINT /
// literal-next); Ctrl+Shift+C/V work on both platforms.
export type TerminalKeyAction = 'copy' | 'paste' | 'passthrough';

export interface TerminalKeyEvent {
  type: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface TerminalKeyContext {
  platform: string;
  hasSelection: boolean;
}

export function resolveTerminalKey(
  event: TerminalKeyEvent,
  ctx: TerminalKeyContext,
): TerminalKeyAction {
  if (event.type !== 'keydown' || event.altKey) return 'passthrough';
  const key = event.key.toLowerCase();
  if (key !== 'c' && key !== 'v') return 'passthrough';
  const darwin = ctx.platform === 'darwin';
  if (darwin) {
    if (event.metaKey && !event.ctrlKey && !event.shiftKey) {
      return key === 'c' ? 'copy' : 'paste';
    }
    if (event.ctrlKey && event.shiftKey && !event.metaKey) {
      return key === 'c' ? 'copy' : 'paste';
    }
    return 'passthrough';
  }
  if (event.metaKey) return 'passthrough';
  if (!event.ctrlKey) return 'passthrough';
  if (key === 'v') return 'paste';
  return event.shiftKey || ctx.hasSelection ? 'copy' : 'passthrough';
}
