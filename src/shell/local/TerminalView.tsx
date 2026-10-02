import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { buttonClass } from './Cards';

interface TerminalViewProps {
  // Host-owned pty id (see terminalHost). The view never opens or closes it.
  id: string;
  // When true, focus the xterm once it is displayed — callers pass it so typed
  // input lands in the terminal instead of staying on the invoking button.
  active?: boolean;
  // When provided, an exit banner offers to restart (LocalPanel's devin pty).
  onRestart?: () => void;
}

export function TerminalView({ id, active = false, onRestart }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const idRef = useRef<string>(id);
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    idRef.current = id;
  }, [id]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setExitCode(null);
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      theme: {
        background: '#0d141d',
        foreground: '#e8edf5',
        cursor: '#83b6ff',
        selectionBackground: '#31455f',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true;
      const key = event.key.toLowerCase();
      if (key === 'c') {
        const selection = term.getSelection();
        if (selection) void navigator.clipboard.writeText(selection);
        return false;
      }
      if (key === 'v') {
        void navigator.clipboard.readText().then((text) => {
          if (text) window.devinworkspaces.terminalInput(idRef.current, text);
        });
        return false;
      }
      return true;
    });
    termRef.current = term;
    term.onData((data) => {
      window.devinworkspaces.terminalInput(idRef.current, data);
    });
    // OSC 0/2 titles become dock tab labels; never logged.
    term.onTitleChange((title) => {
      window.devinworkspaces.terminalTitle(idRef.current, title);
    });
    try {
      fit.fit();
    } catch {
      // zero-size container
    }

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        return;
      }
      window.devinworkspaces.terminalResize(idRef.current, term.cols, term.rows);
    });
    observer.observe(container);

    const offData = window.devinworkspaces.onTerminalData((payload) => {
      if (payload.id === idRef.current) term.write(payload.data);
    });
    const offExit = window.devinworkspaces.onTerminalExit((payload) => {
      if (payload.id === idRef.current) setExitCode(payload.exitCode);
    });

    window.devinworkspaces.terminalResize(id, term.cols, term.rows);

    return () => {
      offData();
      offExit();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      // The host pty stays alive — it is keyed by id and reused on remount.
    };
  }, [id]);

  // Focus after a rAF: the container may have just flipped display:none→flex.
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => termRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {exitCode !== null && onRestart && (
        <div
          id="terminalExitBar"
          className="flex items-center gap-3 border-b border-[#39475a] bg-[#1a2330] px-3 py-1.5 text-xs text-[#e0a03c]"
        >
          devin exited (code {exitCode})
          <button type="button" className={buttonClass} onClick={onRestart}>
            Restart
          </button>
        </div>
      )}
      <div ref={containerRef} className="min-h-0 flex-1 px-1 pt-1" data-terminal-id={id} />
    </div>
  );
}
