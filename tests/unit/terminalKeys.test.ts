import { describe, expect, it } from 'vitest';
import { resolveTerminalKey, type TerminalKeyEvent } from '../../src/core/terminalKeys';

function key(overrides: Partial<TerminalKeyEvent> = {}): TerminalKeyEvent {
  return {
    type: 'keydown',
    key: '',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe('resolveTerminalKey (win32/linux)', () => {
  const ctx = (hasSelection: boolean) => ({ platform: 'win32', hasSelection });

  it('Ctrl+C copies only with a selection, else passes through as ^C', () => {
    expect(resolveTerminalKey(key({ key: 'c', ctrlKey: true }), ctx(true))).toBe('copy');
    expect(resolveTerminalKey(key({ key: 'c', ctrlKey: true }), ctx(false))).toBe('passthrough');
  });

  it('Ctrl+Shift+C always copies', () => {
    expect(resolveTerminalKey(key({ key: 'c', ctrlKey: true, shiftKey: true }), ctx(false))).toBe(
      'copy',
    );
  });

  it('Ctrl+V and Ctrl+Shift+V paste', () => {
    expect(resolveTerminalKey(key({ key: 'v', ctrlKey: true }), ctx(false))).toBe('paste');
    expect(resolveTerminalKey(key({ key: 'v', ctrlKey: true, shiftKey: true }), ctx(false))).toBe(
      'paste',
    );
  });

  it('key compare is case-insensitive', () => {
    expect(resolveTerminalKey(key({ key: 'V', ctrlKey: true }), ctx(false))).toBe('paste');
  });

  it('keyup and alt combos pass through', () => {
    expect(resolveTerminalKey(key({ type: 'keyup', key: 'v', ctrlKey: true }), ctx(true))).toBe(
      'passthrough',
    );
    expect(resolveTerminalKey(key({ key: 'v', ctrlKey: true, altKey: true }), ctx(true))).toBe(
      'passthrough',
    );
  });

  it('meta combos and plain letters pass through', () => {
    expect(resolveTerminalKey(key({ key: 'c', metaKey: true }), ctx(true))).toBe('passthrough');
    expect(resolveTerminalKey(key({ key: 'c', ctrlKey: true, metaKey: true }), ctx(true))).toBe(
      'passthrough',
    );
    expect(resolveTerminalKey(key({ key: 'x', ctrlKey: true }), ctx(true))).toBe('passthrough');
    expect(resolveTerminalKey(key({ key: 'c' }), ctx(true))).toBe('passthrough');
  });
});

describe('resolveTerminalKey (darwin)', () => {
  const ctx = (hasSelection: boolean) => ({ platform: 'darwin', hasSelection });

  it('Cmd+C copies and Cmd+V pastes regardless of selection', () => {
    expect(resolveTerminalKey(key({ key: 'c', metaKey: true }), ctx(false))).toBe('copy');
    expect(resolveTerminalKey(key({ key: 'v', metaKey: true }), ctx(false))).toBe('paste');
  });

  it('plain Ctrl+C/Ctrl+V pass through (SIGINT / literal-next)', () => {
    expect(resolveTerminalKey(key({ key: 'c', ctrlKey: true }), ctx(true))).toBe('passthrough');
    expect(resolveTerminalKey(key({ key: 'v', ctrlKey: true }), ctx(false))).toBe('passthrough');
  });

  it('Ctrl+Shift+C/V still copy and paste', () => {
    expect(resolveTerminalKey(key({ key: 'c', ctrlKey: true, shiftKey: true }), ctx(false))).toBe(
      'copy',
    );
    expect(resolveTerminalKey(key({ key: 'v', ctrlKey: true, shiftKey: true }), ctx(false))).toBe(
      'paste',
    );
  });

  it('Cmd+Shift and Cmd+Ctrl combos pass through', () => {
    expect(
      resolveTerminalKey(key({ key: 'c', metaKey: true, shiftKey: true }), ctx(true)),
    ).toBe('passthrough');
    expect(
      resolveTerminalKey(key({ key: 'c', metaKey: true, ctrlKey: true }), ctx(true)),
    ).toBe('passthrough');
  });
});
