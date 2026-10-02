// P6: read Windows Terminal's settings.json (JSONC) so the dock's default
// shell matches the user's Windows Terminal default profile. Pure module —
// no node/electron imports; callers supply env, distro list and existsSync.

// Strip // line and /* */ block comments (outside strings) + trailing commas.
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      i--; // the \n is re-emitted below
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  // Trailing commas before } or ] (outside strings — comments are gone).
  const stripped = out.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(stripped);
}

export interface WtProfile {
  guid: string;
  name: string;
  source?: string | undefined;
  commandline?: string | undefined;
  hidden: boolean;
  startingDirectory?: string | undefined;
}

interface WtFile {
  defaultProfile: string | null;
  profiles: WtProfile[];
}

export function readProfiles(settingsJson: unknown): WtFile {
  const root = (settingsJson ?? {}) as Record<string, unknown>;
  const profilesNode = root['profiles'];
  const list = Array.isArray(profilesNode)
    ? profilesNode
    : Array.isArray((profilesNode as Record<string, unknown> | undefined)?.['list'])
      ? ((profilesNode as Record<string, unknown>)['list'] as unknown[])
      : [];
  const profiles: WtProfile[] = [];
  for (const item of list) {
    const p = item as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') continue;
    if (p['hidden'] === true) continue;
    profiles.push({
      guid: String(p['guid'] ?? ''),
      name: String(p['name'] ?? ''),
      source: typeof p['source'] === 'string' ? p['source'] : undefined,
      commandline: typeof p['commandline'] === 'string' ? p['commandline'] : undefined,
      hidden: false,
      startingDirectory:
        typeof p['startingDirectory'] === 'string' ? p['startingDirectory'] : undefined,
    });
  }
  const def = root['defaultProfile'];
  return { defaultProfile: typeof def === 'string' ? def : null, profiles };
}

// Windows paths use %VAR%; expand from the given env map (missing → kept).
export function expandEnvVars(command: string, env: Record<string, string | undefined>): string {
  const lower = new Map(Object.keys(env).map((k) => [k.toUpperCase(), env[k]]));
  return command.replace(/%([^%]+)%/g, (m, name: string) => lower.get(name.toUpperCase()) ?? m);
}

// Split a command line on spaces, respecting double quotes (WT convention).
export function splitCommandline(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of command.trim()) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if ((ch === ' ' || ch === '\t') && !inQuotes) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const DISTRO_SOURCE = /Ubuntu|Debian|SUSE|kali|Alpine|Fedora|Oracle|Pengwin|WLinux|Arch|Linux/i;
const WSL_SOURCES = new Set(['Microsoft.WSL', 'Windows.Terminal.Wsl']);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, '');

// Best distro match for a WT profile name ("Ubuntu 22.04.5 LTS" → "Ubuntu-22.04").
function matchDistro(name: string, distros: string[]): string | null {
  const target = norm(name);
  if (!target) return null;
  const exact = distros.find((d) => norm(d) === target);
  if (exact) return exact;
  const starts = distros.find((d) => norm(d).startsWith(target) || target.startsWith(norm(d)));
  if (starts) return starts;
  const prefix = distros.find((d) => target.startsWith(norm(d)));
  return prefix ?? null;
}

export interface ResolvedShell {
  file: string;
  args: string[];
  label: string;
}

export interface ResolveCtx {
  env: Record<string, string | undefined>;
  distros: string[];
  pwshPath: string | null;
  windowsAppsDir: string | null;
  existsSync(p: string): boolean;
}

// Map a WT profile to a spawnable command; null = not embeddable.
export function resolveProfileCommand(profile: WtProfile, ctx: ResolveCtx): ResolvedShell | null {
  if (profile.commandline) {
    const [file, ...args] = splitCommandline(expandEnvVars(profile.commandline, ctx.env));
    if (!file) return null;
    return { file, args, label: profile.name };
  }
  const source = profile.source ?? '';
  if (source === 'Windows.Terminal.PowershellCore') {
    return ctx.pwshPath ? { file: ctx.pwshPath, args: [], label: profile.name } : null;
  }
  if (WSL_SOURCES.has(source) || DISTRO_SOURCE.test(source) || DISTRO_SOURCE.test(profile.name)) {
    const distro = matchDistro(profile.name, ctx.distros);
    if (!distro) return null;
    return { file: 'wsl.exe', args: ['-d', distro], label: profile.name };
  }
  // Azure Cloud Shell / Visual Studio developer prompts need WT's own shell.
  return null;
}

// Known settings.json locations (packaged, packaged Preview, unpackaged).
export function settingsCandidates(localAppData: string): string[] {
  const pkg = (name: string) =>
    `${localAppData}\\Packages\\${name}\\LocalState\\settings.json`;
  return [
    pkg('Microsoft.WindowsTerminal_8wekyb3d8bbwe'),
    pkg('Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe'),
    `${localAppData}\\Microsoft\\Windows Terminal\\settings.json`,
  ];
}
