import { useSyncExternalStore } from 'react';
import type { LocalStatePublic } from '../../shared/ipc';

let current: LocalStatePublic | null = null;
const listeners = new Set<() => void>();
let subscribed = false;

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  if (!subscribed) {
    subscribed = true;
    window.devinworkspaces.onLocalState((next) => {
      current = next;
      emit();
    });
    void window.devinworkspaces.getLocalState().then((next) => {
      current = next;
      emit();
    });
  }
  return () => listeners.delete(callback);
}

export function useLocalState(): LocalStatePublic | null {
  return useSyncExternalStore(subscribe, () => current);
}
