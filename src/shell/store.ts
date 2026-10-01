import { useSyncExternalStore } from 'react';
import type { ShellState } from '../shared/ipc';
import type { DevinWorkspacesApi } from './preload';

declare global {
  interface Window {
    devinworkspaces: DevinWorkspacesApi;
  }
}

let current: ShellState | null = null;
const listeners = new Set<() => void>();
let subscribed = false;

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  if (!subscribed) {
    subscribed = true;
    window.devinworkspaces.onState((next) => {
      current = next;
      listeners.forEach((listener) => listener());
    });
    void window.devinworkspaces.getState().then((next) => {
      current = next;
      listeners.forEach((listener) => listener());
    });
  }
  return () => listeners.delete(callback);
}

export function useShellState(): ShellState | null {
  return useSyncExternalStore(subscribe, () => current);
}
