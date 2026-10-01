import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { buttonClass } from './Cards';

interface TerminalViewProps {
  workspace: string;
}

export function TerminalView({ workspace }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
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
          if (idRef.current && text) window.devinworkspaces.terminalInput(idRef.current, text);
        });
        return false;
      }
      return true;
    });
    term.onData((data) => {
      if (idRef.current) window.devinworkspaces.terminalInput(idRef.current, data);
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
      if (idRef.current) window.devinworkspaces.terminalResize(idRef.current, term.cols, term.rows);
    });
    observer.observe(container);

    const offData = window.devinworkspaces.onTerminalData((payload) => {
      if (payload.id === idRef.current) term.write(payload.data);
    });
    const offExit = window.devinworkspaces.onTerminalExit((payload) => {
      if (payload.id === idRef.current) setExitCode(payload.exitCode);
    });

    let cancelled = false;
    void window.devinworkspaces.terminalOpen(workspace).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        idRef.current = result.id;
        setError(null);
        window.devinworkspaces.terminalResize(result.id, term.cols, term.rows);
      } else {
        setError(result.error);
      }
    });

    return () => {
      cancelled = true;
      offData();
      offExit();
      observer.disconnect();
      term.dispose();
      // The host pty stays alive — it is keyed by workspace and reused on remount.
      idRef.current = null;
    };
  }, [workspace, restarting]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {exitCode !== null && (
        <div
          id="terminalExitBar"
          className="flex items-center gap-3 border-b border-[#39475a] bg-[#1a2330] px-3 py-1.5 text-xs text-[#e0a03c]"
        >
          devin exited (code {exitCode})
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setExitCode(null);
              setError(null);
              setRestarting((n) => n + 1);
            }}
          >
            Restart
          </button>
        </div>
      )}
      {error && (
        <div className="border-b border-[#39475a] px-3 py-1.5 text-xs text-[#ff8a8a]">{error}</div>
      )}
      <div ref={containerRef} className="min-h-0 flex-1 px-1 pt-1" data-workspace={workspace} />
    </div>
  );
}
