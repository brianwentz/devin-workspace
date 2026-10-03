import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type * as pty from 'node-pty';
import { app } from 'electron';
import { INSTALL_GUIDANCE } from '../../core/localModel';
import {
  parseJsonc,
  readProfiles,
  resolveProfileCommand,
  settingsCandidates,
  splitCommandline,
  expandEnvVars,
  type ResolvedShell,
  type WtProfile,
} from '../../core/windowsTerminal';
import { IpcChannels, type TerminalSummary } from '../../shared/ipc';
import { LinkScanner } from '../../core/prLinks';
import { log } from '../log';
import { fixtureOrigins, state } from '../state';
import { resolveDevinPath } from './acpHost';

export type TerminalKind = 'devin' | 'shell';
export type TerminalOpenOptions =
  | { kind: 'devin'; workspace: string; sessionId: string }
  | { kind: 'shell'; cwd?: string | undefined; profile?: string | undefined };

export interface ShellProfileInfo {
  guid: string;
  name: string;
  default: boolean;
  available: boolean;
}

type ResolvedCommand = { file: string; args: string[]; label: string | null; appendCwd: boolean };

export type { TerminalSummary };

interface TerminalEntry {
  id: string;
  kind: TerminalKind;
  sessionId: string | null;
  cwd: string;
  title: string;
  profile: string | null;
  proc: pty.IPty;
  exitCode: number | null;
  pending: string;
  timer: NodeJS.Timeout | null;
  // F2: cumulative output bytes since the last sampled `terminal-data` log.
  bytesOut: number;
  lastDataLogAt: number;
  // Test mode only: rolling output buffer for __devinworkspaces.terminalRead.
  readBuffer: string;
  // Devin-kind only: PR-URL scanner over the pty output stream.
  linkScanner: LinkScanner | null;
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

// One interactive `devin` CLI pty per local session (fresh TUI — no `-r`, so
// each session gets its own context). The external binary is spawned
// via node-pty/ConPTY — never node (RunAsNode fuse is off). A full command
// override exists only in test mode (DEVIN_WORKSPACES_TEST_TERMINAL_CMD).
export class TerminalHost {
  private readonly terminals = new Map<string, TerminalEntry>();
  private readonly bySession = new Map<string, string>();

  constructor(private readonly testMode: boolean) {}

  private resolveCommand(options: TerminalOpenOptions): ResolvedCommand | { error: string } {
    const kind = options.kind;
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
        return { file: resolvedFile, args: resolvedArgs, label: null, appendCwd: false };
      }
    }
    if (kind === 'devin') {
      const devinPath = resolveDevinPath(state.settings?.current.local.devinPath);
      if (!devinPath) return { error: INSTALL_GUIDANCE };
      return { file: devinPath, args: [], label: null, appendCwd: false };
    }
    const shell = this.resolveShellCommand(
      options.kind === 'shell' ? options.profile : undefined,
    );
    if (!shell) return { error: 'no shell found' };
    return shell;
  }

  // `wsl.exe -l -q` prints UTF-16LE; cache for the process lifetime.
  private wslDistrosCache: string[] | null = null;
  private wslDistros(): string[] {
    if (this.wslDistrosCache) return this.wslDistrosCache;
    try {
      const result = spawnSync('wsl.exe', ['-l', '-q'], { encoding: 'utf16le', windowsHide: true });
      const raw = result.stdout ?? '';
      this.wslDistrosCache = raw
        .split(/[\r\n]+/)
        .map((line) => line.replace(/[^\x20-\x7E]/g, '').trim())
        .filter((line) => line.length > 0 && !line.startsWith('('));
    } catch {
      this.wslDistrosCache = [];
    }
    return this.wslDistrosCache;
  }

  private pwshPathCache: string | null | undefined;
  private pwshPath(): string | null {
    if (this.pwshPathCache !== undefined) return this.pwshPathCache;
    const seven = process.env['ProgramFiles']
      ? join(process.env['ProgramFiles'], 'PowerShell', '7', 'pwsh.exe')
      : null;
    this.pwshPathCache =
      resolveOnPath('pwsh.exe') ?? (seven && existsSync(seven) ? seven : null);
    return this.pwshPathCache;
  }

  private wtFile(): { file: import('../../core/windowsTerminal').WtProfile[] | { profiles: WtProfile[]; defaultProfile: string | null } | null } | null {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return null;
    for (const candidate of settingsCandidates(localAppData)) {
      if (!existsSync(candidate)) continue;
      try {
        return { file: readProfiles(parseJsonc(readFileSync(candidate, 'utf8'))) };
      } catch {
        return null;
      }
    }
    return null;
  }

  private wtCtx() {
    return {
      env: process.env as Record<string, string | undefined>,
      distros: this.wslDistros(),
      pwshPath: this.pwshPath(),
      windowsAppsDir: process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft\WindowsApps') : null,
      existsSync,
    };
  }

  // WT profile list for the picker — re-read each call so edits apply.
  profiles(): ShellProfileInfo[] {
    if (process.platform !== 'win32') return [];
    const wt = this.wtFile();
    if (!wt?.file) return [];
    const ctx = this.wtCtx();
    const list = wt.file as { profiles: WtProfile[]; defaultProfile: string | null };
    return list.profiles.map((p) => ({
      guid: p.guid,
      name: p.name,
      default: p.guid === list.defaultProfile,
      available: resolveProfileCommand(p, ctx) !== null,
    }));
  }

  // Shell resolution order: settings.terminal.shell command line → the picked
  // or default Windows Terminal profile → pwsh → powershell → COMSPEC.
  private resolveShellCommand(profileGuid?: string): ResolvedCommand | null {
    const setting = state.settings?.current.terminal.shell?.trim();
    if (setting) {
      const [file, ...args] = splitCommandline(expandEnvVars(setting, process.env as Record<string, string | undefined>));
      if (file) {
        log('local', 'terminal-shell-resolved', {
          detail: { source: 'setting', profile: null, file: basename(file) },
        });
        return { file, args, label: null, appendCwd: false };
      }
    }
    const wt = this.wtFile();
    if (wt?.file) {
      const ctx = this.wtCtx();
      const list = wt.file as { profiles: WtProfile[]; defaultProfile: string | null };
      const profile = profileGuid
        ? list.profiles.find((p) => p.guid === profileGuid)
        : list.profiles.find((p) => p.guid === list.defaultProfile);
      const resolved = profile ? resolveProfileCommand(profile, ctx) : null;
      if (profile && resolved) {
        log('local', 'terminal-shell-resolved', {
          detail: { source: 'windows-terminal', profile: profile.name, file: basename(resolved.file) },
        });
        return { file: resolved.file, args: resolved.args, label: resolved.label, appendCwd: resolved.file.toLowerCase() === 'wsl.exe' };
      }
      if (profileGuid && profile) {
        return { error: `profile not launchable: ${profile.name}` } as ResolvedCommand & { error: string };
      }
    }
    if (process.platform !== 'win32') {
      const file =
        (process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : null) ??
        (existsSync('/bin/zsh') ? '/bin/zsh' : null) ??
        (existsSync('/bin/bash') ? '/bin/bash' : null);
      if (!file) return null;
      log('local', 'terminal-shell-resolved', {
        detail: { source: 'fallback', profile: null, file: basename(file) },
      });
      return { file, args: ['-l'], label: null, appendCwd: false };
    }
    const found = resolveOnPath('pwsh.exe') ?? resolveOnPath('powershell.exe');
    const file = found ?? (process.env.COMSPEC && existsSync(process.env.COMSPEC) ? process.env.COMSPEC : null);
    if (!file) return null;
    log('local', 'terminal-shell-resolved', {
      detail: { source: 'fallback', profile: null, file: basename(file) },
    });
    return { file, args: [], label: null, appendCwd: false };
  }

  // Pty env: drop inherited vars that break or redirect child processes —
  // NODE_OPTIONS/ELECTRON_RUN_AS_NODE re-route node/electron children
  // (ELECTRON_RUN_AS_NODE in particular turns spawned devin/node binaries into
  // plain node), NODE_INSPECT_* hijack ports, and JB_*/IDEA_*/WEBSTORM_* leak
  // IDE debugger hooks when launched from JetBrains. Only names are logged.
  private ptyEnv(kind: TerminalKind): Record<string, string> {
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
    const added: string[] = [];
    // The devin CLI classifies its host terminal from TERM_PROGRAM/WT_SESSION;
    // a ConPTY-backed xterm looks like conhost, so pose as Windows Terminal.
    if (kind === 'devin' && process.platform === 'win32') {
      if (env.WT_SESSION === undefined) {
        env.WT_SESSION = randomUUID();
        added.push('WT_SESSION');
      }
      if (env.TERM_PROGRAM === undefined) {
        env.TERM_PROGRAM = 'WindowsTerminal';
        added.push('TERM_PROGRAM');
      }
    }
    if (stripped.length > 0 || added.length > 0) {
      log('local', 'terminal-env', { detail: { stripped, added } });
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
        detail: {
          cwd: normalized,
          kind: options.kind,
          ok: false,
          error: 'cwd not allowed',
          ...(options.kind === 'devin' ? { sessionId: options.sessionId } : {}),
        },
      });
      return { ok: false, error: 'cwd not allowed' };
    }
    if (options.kind === 'devin') {
      const existingId = this.bySession.get(options.sessionId);
      if (existingId) {
        const existing = this.terminals.get(existingId);
        if (existing && existing.exitCode === null) return { ok: true, id: existingId };
      }
    }
    const command = this.resolveCommand(options);
    if ('error' in command) {
      log('local', 'terminal-open', { detail: { cwd: normalized, ok: false } });
      return { ok: false, error: command.error };
    }
    let proc: pty.IPty;
    try {
      // Lazy: a missing/broken native addon must not break app startup.
      const nodePty = require('node-pty') as typeof pty;
      const args = command.appendCwd ? [...command.args, '--cd', normalized] : command.args;
      proc = nodePty.spawn(command.file, args, {
        cwd: normalized,
        cols,
        rows,
        env: this.ptyEnv(options.kind),
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
      sessionId: options.kind === 'devin' ? options.sessionId : null,
      cwd: normalized,
      title: basename(normalized) || normalized,
      profile: command.label,
      proc,
      exitCode: null,
      pending: '',
      timer: null,
      bytesOut: 0,
      lastDataLogAt: 0,
      readBuffer: '',
      linkScanner:
        options.kind === 'devin'
          ? new LinkScanner({ context: { githubOrigins: fixtureOrigins } })
          : null,
    };
    this.terminals.set(entry.id, entry);
    if (options.kind === 'devin') this.bySession.set(options.sessionId, entry.id);
    proc.onData((data) => this.pushData(entry, data));
    proc.onExit(({ exitCode }) => {
      entry.exitCode = exitCode;
      this.flush(entry);
      if (entry.linkScanner && entry.sessionId && this.onPullRequestUrl) {
        const sessionId = entry.sessionId;
        for (const url of entry.linkScanner.flush()) {
          this.onPullRequestUrl(url, sessionId);
        }
      }
      if (entry.bytesOut > 0) {
        log('local', 'terminal-data', { detail: { id: entry.id, bytes: entry.bytesOut } });
        entry.bytesOut = 0;
      }
      if (entry.sessionId && this.bySession.get(entry.sessionId) === entry.id) {
        this.bySession.delete(entry.sessionId);
      }
      const view = state.shellView;
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.send(IpcChannels.terminalExit, {
          id: entry.id,
          exitCode,
        });
      }
      log('local', 'terminal-exit', { detail: { id: entry.id, exitCode } });
      this.onChange?.();
    });
    log('local', 'terminal-open', {
      detail: {
        id: entry.id,
        cwd: normalized,
        kind: options.kind,
        ok: true,
        pid: proc.pid,
        ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
      },
    });
    this.onChange?.();
    return { ok: true, id: entry.id };
  }

  // Wired by the main process to refresh ShellState.terminals.
  onChange: (() => void) | null = null;
  // Injected by index.ts: a never-before-seen PR URL in a devin pty's output.
  onPullRequestUrl: ((url: string, sessionId: string) => void) | null = null;

  list(): TerminalSummary[] {
    return [...this.terminals.values()].map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      sessionId: entry.sessionId,
      cwd: entry.cwd,
      title: entry.title,
      exitCode: entry.exitCode,
      profile: entry.profile,
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
    if (entry.linkScanner && entry.sessionId && this.onPullRequestUrl) {
      const sessionId = entry.sessionId;
      for (const url of entry.linkScanner.scan(data)) {
        this.onPullRequestUrl(url, sessionId);
      }
    }
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
    if (entry.sessionId && this.bySession.get(entry.sessionId) === id) {
      this.bySession.delete(entry.sessionId);
    }
    log('local', 'terminal-close', { detail: { id } });
    this.onChange?.();
    return true;
  }

  closeForWorkspace(workspace: string): void {
    const normalized = resolve(workspace);
    for (const entry of [...this.terminals.values()]) {
      if (entry.kind === 'devin' && entry.cwd === normalized) this.close(entry.id);
    }
  }

  closeForSession(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id) this.close(id);
  }

  pid(id: string): number | null {
    return this.terminals.get(id)?.proc.pid ?? null;
  }

  read(id: string): string {
    return this.terminals.get(id)?.readBuffer ?? '';
  }

  // Kills every pty and waits (bounded) for them to exit — ConPTY teardown
  // threads can otherwise deadlock the host process's own exit(). Per-entry
  // failures are isolated: a throw here must never abort the caller's quit.
  async dispose(): Promise<void> {
    const waits: Promise<unknown>[] = [];
    for (const id of [...this.terminals.keys()]) {
      try {
        const entry = this.terminals.get(id);
        if (entry) {
          waits.push(
            new Promise((resolve) => {
              try {
                entry.proc.onExit(resolve);
              } catch {
                // onExit registration on a half-dead pty — the timeout covers it.
              }
              setTimeout(resolve, 2000);
            }),
          );
          // Kill the child tree before proc.kill(): ClosePseudoConsole on a
          // live ConPTY host can deadlock the libuv loop at quit (observed:
          // terminal-close logged, then nothing — timers never fire).
          if (process.platform === 'win32' && entry.exitCode === null) {
            spawnSync('taskkill', ['/PID', String(entry.proc.pid), '/T', '/F'], {
              stdio: 'ignore',
            });
          }
        }
        this.close(id);
      } catch (error) {
        log('local', 'terminal-dispose-error', {
          detail: { id, message: error instanceof Error ? error.message : String(error) },
        });
      }
    }
    await Promise.all(waits);
  }
}


export const terminalHost = new TerminalHost(process.env.DEVIN_WORKSPACES_TEST === '1');
