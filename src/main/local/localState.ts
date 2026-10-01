import { emptyLocalState, type LocalState } from '../../core/localModel';
import { IpcChannels, LocalStateSchema } from '../../shared/ipc';
import { log } from '../log';
import { state } from '../state';

// In-memory LocalState; mutated only through `update()` with pure reducers from
// core/localModel. Pushes are coalesced per tick so a burst of session/update
// notifications becomes one `local:update` message.
let current: LocalState = emptyLocalState(null);
let scheduled = false;

export function getLocalState(): LocalState {
  return current;
}

export function replaceLocalState(next: LocalState): void {
  current = next;
  schedulePublish();
}

export function update(reducer: (state: LocalState) => LocalState): LocalState {
  const next = reducer(current);
  if (next !== current) {
    current = next;
    schedulePublish();
  }
  return current;
}

function schedulePublish(): void {
  if (scheduled) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    publishLocalState();
  });
}

export function publicLocalState(): LocalState {
  // Validate the outgoing payload so the renderer never sees a malformed state.
  const parsed = LocalStateSchema.safeParse(current);
  if (parsed.success) return parsed.data as LocalState;
  log('local', 'state-invalid', { detail: { issues: parsed.error.issues.slice(0, 5) } });
  return emptyLocalState(current.cliPath);
}

export function publishLocalState(): void {
  const view = state.shellView;
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.send(IpcChannels.localUpdate, publicLocalState());
}
