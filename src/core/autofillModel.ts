// Pure login-form heuristics: the preload collects FieldDescriptors from the
// DOM, this module decides which groups of inputs look like login forms.

export interface FieldDescriptor {
  index: number; // position in document order among candidate inputs
  type: string; // lowercased input type ('' for missing)
  name: string; // lowercased
  id: string; // lowercased
  autocomplete: string; // lowercased attribute value
  placeholder: string; // lowercased
  ariaLabel: string; // lowercased aria-label
  visible: boolean; // non-zero rect, not hidden/disabled/readonly
  formIndex: number | null; // index of the owning <form>, null if none
}

export interface LoginForm {
  usernameIndex: number | null;
  passwordIndex: number | null;
}

export const USERNAME_HINT = /user|email|login|account|identifier|e-mail|phone/;
const SEARCH_HINT = /search|query|^q$/;
const TEXT_LIKE = new Set(['text', 'email', 'tel', '']);

function isSearchish(field: FieldDescriptor): boolean {
  return (
    field.type === 'search' ||
    SEARCH_HINT.test(field.name) ||
    SEARCH_HINT.test(field.id) ||
    SEARCH_HINT.test(field.ariaLabel)
  );
}

function isUsernameCandidate(field: FieldDescriptor): boolean {
  return TEXT_LIKE.has(field.type) && !isSearchish(field);
}

function isUsernameHinted(field: FieldDescriptor): boolean {
  return (
    field.autocomplete === 'username' ||
    field.autocomplete === 'email' ||
    USERNAME_HINT.test(field.name) ||
    USERNAME_HINT.test(field.id) ||
    USERNAME_HINT.test(field.placeholder) ||
    USERNAME_HINT.test(field.ariaLabel)
  );
}

export function detectLoginForms(fields: FieldDescriptor[]): LoginForm[] {
  const visible = fields.filter((field) => field.visible);
  const anyPassword = visible.some((field) => field.type === 'password');
  const groups = new Map<number | 'none', FieldDescriptor[]>();
  for (const field of visible) {
    const key = field.formIndex ?? 'none';
    const group = groups.get(key) ?? [];
    group.push(field);
    groups.set(key, group);
  }
  const results: LoginForm[] = [];
  for (const group of groups.values()) {
    const passwords = group.filter((field) => field.type === 'password');
    // 2+ visible passwords = signup / change-password, not a login.
    if (passwords.length >= 2) continue;
    if (passwords.length === 1) {
      const password = passwords[0]!;
      if (password.autocomplete === 'new-password') continue;
      const candidates = group.filter(
        (field) => isUsernameCandidate(field) && field.index < password.index,
      );
      const hinted = candidates.filter(isUsernameHinted);
      const username =
        hinted.find(
          (field) => field.autocomplete === 'username' || field.autocomplete === 'email',
        ) ??
        hinted[hinted.length - 1] ??
        candidates[candidates.length - 1];
      results.push({
        usernameIndex: username?.index ?? null,
        passwordIndex: password.index,
      });
      continue;
    }
    // Username-only step (e.g. Okta identifier-first): no visible password in
    // the whole document, and this group has a single clearly-username field
    // among at most two text-like inputs.
    if (anyPassword) continue;
    const candidates = group.filter(isUsernameCandidate);
    if (candidates.length > 2) continue;
    const qualifying = candidates.filter(isUsernameHinted);
    if (qualifying.length === 1) {
      results.push({ usernameIndex: qualifying[0]!.index, passwordIndex: null });
    }
  }
  return results;
}
