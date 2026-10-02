// Autofill content script. Runs in the isolated world of hosted views (devin
// view + GitHub tabs). Deliberately exposes NOTHING on window — the page can
// only observe it through DOM field values. Structured so a submit listener
// ("save password?" capture) can be added later.
import { ipcRenderer } from 'electron';
import { detectLoginForms, type FieldDescriptor } from '../core/autofillModel';

// Never run in a frame cross-origin to its top (a cross-origin iframe could
// otherwise harvest fills meant for the top document). Main re-checks anyway.
const crossOriginSubframe = (() => {
  if (window.top === window) return false;
  try {
    return window.top!.location.origin !== window.location.origin;
  } catch {
    return true;
  }
})();

if (!crossOriginSubframe) {
  init();
}

function init(): void {
  interface FormHit {
    username: HTMLInputElement | null;
    password: HTMLInputElement | null;
  }

  interface QueryResponse {
    accounts?: { id: string; username: string }[];
    fill?: { id: string; username: string; password: string | null } | null;
  }

  const handled = new WeakSet<HTMLInputElement>();
  const usernameFields = new WeakSet<HTMLInputElement>();
  const autofilled = new WeakMap<HTMLInputElement, string>();
  // Forms with >1 saved account: focus/click on a field asks main for a picker.
  const pickerForms = new Set<FormHit>();
  let lastPicker: FormHit | null = null;
  let lastUsername = '';
  let queryCount = 0;
  let lastQueryAt = 0;
  const queue: FormHit[] = [];
  let pumping = false;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;

  const nativeSet = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!;

  function collect(): { el: HTMLInputElement; descriptor: FieldDescriptor }[] {
    const forms: HTMLFormElement[] = [];
    const inputs: HTMLInputElement[] = [];
    const walk = (root: Document | ShadowRoot) => {
      for (const el of root.querySelectorAll('*')) {
        if (el instanceof HTMLInputElement) inputs.push(el);
        else if (el instanceof HTMLFormElement) forms.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return inputs.map((el, index) => {
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      const rect = el.getBoundingClientRect();
      const descriptor: FieldDescriptor = {
        index,
        type,
        name: (el.getAttribute('name') ?? '').toLowerCase(),
        id: el.id.toLowerCase(),
        autocomplete: (el.getAttribute('autocomplete') ?? '').toLowerCase(),
        placeholder: (el.getAttribute('placeholder') ?? '').toLowerCase(),
        ariaLabel: (el.getAttribute('aria-label') ?? '').toLowerCase(),
        visible:
          type !== 'hidden' &&
          !el.disabled &&
          !el.readOnly &&
          rect.width > 0 &&
          rect.height > 0,
        formIndex: el.form ? forms.indexOf(el.form) : null,
      };
      return { el, descriptor };
    });
  }

  function setValue(el: HTMLInputElement, value: string): void {
    nativeSet.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillForm(
    hit: FormHit,
    fill: { id: string; username: string; password: string | null },
    overwrite: boolean,
  ): void {
    if (hit.username && document.contains(hit.username)) {
      const previous = autofilled.get(hit.username);
      if (overwrite || hit.username.value === '' || hit.username.value === previous) {
        setValue(hit.username, fill.username);
        autofilled.set(hit.username, fill.username);
        lastUsername = fill.username.slice(0, 256);
      }
    }
    if (hit.password && document.contains(hit.password) && fill.password !== null) {
      if (overwrite || hit.password.value === '') {
        setValue(hit.password, fill.password);
        autofilled.set(hit.password, fill.password);
      }
    }
  }

  async function runQuery(hit: FormHit): Promise<void> {
    queryCount += 1;
    lastQueryAt = Date.now();
    const hint =
      (hit.username && hit.username.value ? hit.username.value : lastUsername).slice(0, 256) ||
      null;
    const response = (await ipcRenderer
      .invoke('autofill:query', { hasPassword: hit.password !== null, hint })
      .catch(() => undefined)) as QueryResponse | undefined;
    if (!response || typeof response !== 'object') return;
    const accounts = Array.isArray(response.accounts) ? response.accounts : [];
    if (response.fill) fillForm(hit, response.fill, false);
    if (!response.fill && accounts.length > 1) pickerForms.add(hit);
  }

  function pump(): void {
    if (pumping) return;
    const hit = queue.shift();
    if (!hit) return;
    pumping = true;
    const wait = Math.max(0, 500 - (Date.now() - lastQueryAt));
    setTimeout(() => {
      pumping = false;
      void runQuery(hit);
      pump();
    }, wait);
  }

  function enqueueQuery(hit: FormHit): void {
    if (queryCount >= 20) return;
    queue.push(hit);
    pump();
  }

  function scan(): void {
    const collected = collect();
    const byIndex = new Map<number, HTMLInputElement>(
      collected.map(({ el, descriptor }) => [descriptor.index, el]),
    );
    for (const form of detectLoginForms(collected.map((c) => c.descriptor))) {
      const username =
        form.usernameIndex !== null ? (byIndex.get(form.usernameIndex) ?? null) : null;
      const password =
        form.passwordIndex !== null ? (byIndex.get(form.passwordIndex) ?? null) : null;
      const key = password ?? username;
      if (!key || handled.has(key)) continue;
      handled.add(key);
      if (username) usernameFields.add(username);
      enqueueQuery({ username, password });
    }
  }

  function scheduleScan(): void {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 250);
  }

  function sendPicker(el: HTMLInputElement, field: 'username' | 'password'): void {
    const rect = el.getBoundingClientRect();
    ipcRenderer.send('autofill:picker', {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      field,
    });
  }

  // ipcRenderer.on is fine inside a preload — nothing is exposed to the page.
  ipcRenderer.on('autofill:fill', (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { username, password } = payload as { username?: unknown; password?: unknown };
    if (typeof username !== 'string' || typeof password !== 'string' || !lastPicker) return;
    fillForm(lastPicker, { id: '', username, password }, true);
  });

  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      scan();
      for (const hit of pickerForms) {
        if (target === hit.username || target === hit.password) {
          lastPicker = hit;
          sendPicker(target, target === hit.password ? 'password' : 'username');
          break;
        }
      }
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      for (const hit of pickerForms) {
        if (target === hit.username || target === hit.password) {
          lastPicker = hit;
          sendPicker(target, target === hit.password ? 'password' : 'username');
          break;
        }
      }
    },
    true,
  );

  document.addEventListener(
    'input',
    (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && usernameFields.has(target)) {
        lastUsername = target.value.slice(0, 256);
      }
    },
    true,
  );

  const observer = new MutationObserver(() => scheduleScan());
  const observe = () => observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type', 'hidden', 'style', 'class'],
  });
  if (document.documentElement) observe();
  else document.addEventListener('DOMContentLoaded', observe, { once: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } else {
    scan();
  }
  window.addEventListener('load', scan, { once: true });
}
