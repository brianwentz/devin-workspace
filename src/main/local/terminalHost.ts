import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, resolve } from 'node:path';
import type * as pty from 'node-pty';
import { app } from 'electron';
import { INSTALL_GUIDANCE } from '../../core/localModel';
import { IpcChannels, type TerminalSummary } from '../../shared/ipc';
import { log } from '../log';
import { state } from '../state';
import { resolveDevinPath } from './acpHost';

export type TerminalKind = 'devin' | 'shell';
export type TerminalOpenOptions =
  | { kind: 'devin'; workspace: string }
  | { kind: 'shell'; cwd?: string | undefined };

export type { TerminalSummary };

interface TerminalEntry {
  id: string;
  kind: TerminalKind;
  cwd: string;
  title: string;
  proc: pty.IPty;
  exitCode: number | null;
  pending: string;
  timer: NodeJS.Timeout | null;
  // F2: cumulative output bytes since the last sampled `terminal-data` log.
  bytesOut: number;
  lastDataLogAt: number;
  // Test mode only: rolling output buffer for __devinworkspaces.terminalRead.
  readBuffer: string;
}

// Sampled event-log volume for terminal output (F2).
const TERMINAL_LOG_SAMPLE_MS = 5000;

type OpenResult = { ok: true; id: string } | { ok: false; error: string };

// node-pty does not do PATH lookup on Windows — resolve bare names like `node`.
function resolveOnPath(name: string): string | null {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const result = spawnSync(lookup, [name], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) return null;
    const first = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

// One interactive `devin` CLI pty per workspace. The external binary is spawned
// via node-pty/ConPTY — never node (RunAsNode fuse is off). A full command
// override exists only in test mode (DEVIN_WORKSPACES_TEST_TERMINAL_CMD).
export class TerminalHost {
  private readonly terminals = new Map<string, TerminalEntry>();
  private readonly byWorkspace = new Map<string, string>();

  constructor(private readonly testMode: boolean) {}

  private resolveCommand(kind: TerminalKind): { file: string; args: string[] } | { error: string } {
    if (this.testMode) {
      const testCommand = process.env.DEVIN_WORKSPACES_TEST_TERMINAL_CMD;
      if (testCommand) {
        const [file, ...args] = testCommand.split(/\s+/).filter(Boolean);
        if (!file) return { error: 'empty DEVIN_WORKSPACES_TEST_TERMINAL_CMD' };
        const resolvedFile = existsSync(file)
          ? file
          : resolveOnPath(file);
        if (!resolvedFile) return { error: `terminal command not found: ${file}` };
        const resolvedArgs = args.map((arg) => {
          if (isAbsolute(arg)) return arg;
          const candidate = resolve(app.getAppPath(), arg);
          return existsSync(candidate) ? candidate : arg;
        });
        return { file: resolvedFile, args: resolvedArgs };
      }
    }
    if (kind === 'devin') {
      const devinPath = resolveDevinPath(state.settings?.current.local.devinPath);
      if (!devinPath) return { error: INSTALL_GUIDANCE };
      return { file: devinPath, args: [] };
    }
    const shell = resolveShell();
    if (!shell) return { error: 'no shell found on PATH' };
    return { file: shell, args: [] };
  }

  // Pty env: drop inherited vars that break or redirect child processes —
  // NODE_OPTIONS/ELECTRON_RUN_AS_NODE re-route node/electron children
  // (ELECTRON_RUN_AS_NODE in particular turns spawned devin/node binaries into
  // plain node), NODE_INSPECT_* hijack ports, and JB_*/IDEA_*/WEBSTORM_* leak
  // IDE debugger hooks when launched from JetBrains. Only names are logged.
  private ptyEnv(): Record<string, string> {
    const strip = (name: string) =>
      name === 'NODE_OPTIONS' ||
      name.startsWith('NODE_INSPECT_') ||
      name.startsWith('ELECTRON_') ||
      name.startsWith('JB_') ||
      name.startsWith('IDEA_') ||
      name.startsWith('WEBSTORM_');
    const env: Record<string, string> = {};
    const stripped: string[] = [];
    for (const [name, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (strip(name)) stripped.push(name);
      else env[name] = value;
    }
    if (stripped.length > 0) {
      log('local', 'terminal-env', { detail: { stripped } });
    }
    return env;
  }

  open(options: TerminalOpenOptions, cols = 120, rows = 30): OpenResult {
    const workspaces = (state.settings?.current.workspaces ?? []).map((w) => resolve(w));
    const normalized =
      options.kind === 'devin'
        ? resolve(options.workspace)
        : resolve(options.cwd ?? workspaces[0] ?? homedir());
    // Ptys only run inside configured workspaces (plus the home dir for the
    // generic shell kind) — same rule as acpHost's workspace allow-list.
    const allowed =
      options.kind === 'devin' ? workspaces : [...workspaces, resolve(homedir())];
    if (!allowed.includes(normalized)) {
      log('local', 'terminal-open', {
        detail: { cwd: normalized, kind: options.kind, ok: false, error: 'cwd not allowed' },
      });
      return { ok: false, error: 'cwd not allowed' };
    }
    if (options.kind === 'devin') {
      const existingId = this.byWorkspace.get(normalized);
      if (existingId) {
        const existing = this.terminals.get(existingId);
        if (existing && existing.exitCode === null) return { ok: true, id: existingId };
      }
    }
    const command = this.resolveCommand(options.kind);
    if ('error' in command) {
      log('local', 'terminal-open', { detail: { cwd: normalized, ok: false } });
      return { ok: false, error: command.error };
    }
    let proc: pty.IPty;
    try {
      // Lazy: a missing/broken native addon must not break app startup.
      const nodePty = require('node-pty') as typeof pty;
      proc = nodePty.spawn(command.file, command.args, {
        cwd: normalized,
        cols,
        rows,
        env: this.ptyEnv(),
        name: 'xterm-256color',
        useConpty: true,
      });
    } catch (error) {
      log('local', 'terminal-open', {
        detail: { cwd: normalized, ok: false, error: String(error) },
      });
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const entry: TerminalEntry = {
      id: randomUUID(),
      kind: options.kind,
      cwd: normalized,
      title: basename(normalized) || normalized,
      proc,
      exitCode: null,
      pending: '',
      timer: null,
      bytesOut: 0,
      lastDataLogAt: 0,
      readBuffer: '',
    };
    this.terminals.set(entry.id, entry);
    if (options.kind === 'devin') this.byWorkspace.set(normalized, entry.id);
    proc.onData((data) => this.pushData(entry, data));
    proc.onExit(({ exitCode }) => {
      entry.exitCode = exitCode;
      this.flush(entry);
      if (entry.bytesOut > 0) {
        log('local', 'terminal-data', { detail: { id: entry.id, bytes: entry.bytesOut } });
        entry.bytesOut = 0;
      }
      if (this.byWorkspace.get(normalized) === entry.id) this.byWorkspace.delete(normalized);
      state.shellView?.webContents.send(IpcChannels.terminalExit, {
        id: entry.id,
        exitCode,
      });
      log('local', 'terminal-exit', { detail: { id: entry.id, exitCode } });
      this.onChange?.();
    });
    log('local', 'terminal-open', {
      detail: { id: entry.id, cwd: normalized, kind: options.kind, ok: true, pid: proc.pid },
    });
    this.onChange?.();
    return { ok: true, id: entry.id };
  }

  // Wired by the main process to refresh ShellState.terminals.
  onChange: (() => void) | null = null;

  list(): TerminalSummary[] {
    return [...this.terminals.values()].map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      cwd: entry.cwd,
      title: entry.title,
      exitCode: entry.exitCode,
    }));
  }

  setTitle(id: string, title: string): boolean {
    const entry = this.terminals.get(id);
    if (!entry) return false;
    const next = title.slice(0, 256);
    if (next === entry.title) return true;
    entry.title = next;
    this.onChange?.();
    return true;
  }

  // Coalesce pty output within ~8 ms to reduce IPC chatter.
  private pushData(entry: TerminalEntry, data: string): void {
    if (this.testMode) entry.readBuffer = (entry.readBuffer + data).slice(-262144);
    entry.pending += data;
    if (entry.timer) return;
    entry.timer = setTimeout(() => this.flush(entry), 8);
  }

  private flush(entry: TerminalEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (!entry.pending) return;
    const data = entry.pending;
    entry.pending = '';
    const view = state.shellView;
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannels.terminalData, { id: entry.id, data });
    }
    // F2: sample the event log — per-flush logging writes a line every ~8 ms
    // under heavy pty output. Once every 5 s while flowing, plus on exit/close.
    entry.bytesOut += data.length;
    const now = Date.now();
    if (now - entry.lastDataLogAt >= TERMINAL_LOG_SAMPLE_MS) {
      log('local', 'terminal-data', { detail: { id: entry.id, bytes: entry.bytesOut } });
      entry.bytesOut = 0;
      entry.lastDataLogAt = now;
    }
  }

  write(id: string, data: string): boolean {
    const entry = this.terminals.get(id);
    if (!entry || entry.exitCode !== null) return false;
    entry.proc.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const entry = this.terminals.get(id);
    if (!entry || entry.exitCode !== null) return false;
    entry.proc.resize(cols, rows);
    return true;
  }

  close(id: string): boolean {
    const entry = this.terminals.get(id);
    if (!entry) return false;
    try {
      entry.proc.kill();
    } catch {
      // already dead
    }
    if (entry.timer) clearTimeout(entry.timer);
    this.terminals.delete(id);
    if (this.byWorkspace.get(entry.cwd) === id) this.byWorkspace.delete(entry.cwd);
    log('local', 'terminal-close', { detail: { id } });
    this.onChange?.();
    return true;
  }

  closeForWorkspace(workspace: string): void {
    const id = this.byWorkspace.get(resolve(workspace));
    if (id) this.close(id);
  }

  pid(id: string): number | null {
    return this.terminals.get(id)?.proc.pid ?? null;
  }

  read(id: string): string {
    return this.terminals.get(id)?.readBuffer ?? '';
  }

  // Kills every pty and waits (bounded) for them to exit — ConPTY teardown
  // threads can otherwise deadlock the host process's own exit().
  async dispose(): Promise<void> {
    const waits: Promise<unknown>[] = [];
    for (const id of [...this.terminals.keys()]) {
      const entry = this.terminals.get(id);
      if (entry) {
        waits.push(
          new Promise((resolve) => {
            entry.proc.onExit(resolve);
            setTimeout(resolve, 2000);
          }),
        );
      }
      this.close(id);
    }
    await Promise.all(waits);
  }
}

// OS default shell for the generic 'shell' terminal kind.
function resolveShell(): string | null {
  if (process.platform === 'win32') {
    const found = resolveOnPath('pwsh.exe') ?? resolveOnPath('powershell.exe');
    if (found) return found;
    const comspec = process.env.COMSPEC;
    return comspec && existsSync(comspec) ? comspec : null;
  }
  for (const candidate of [process.env.SHELL, '/bin/zsh', '/bin/bash']) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

export const terminalHost = new TerminalHost(process.env.DEVIN_WORKSPACES_TEST === '1');
