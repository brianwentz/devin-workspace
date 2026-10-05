import { useState } from 'react';
import type { DraftField } from '../../../core/settingsDraft';
import { updateDraft, useSettingsDraft } from '../../settingsDraft';
import { errorTextClass, inputClass, inputErrorClass, saveClass } from './styles';

function fieldInputClass(errors: Partial<Record<DraftField, string>>, field: DraftField): string {
  return errors[field] ? `${inputClass} ${inputErrorClass}` : inputClass;
}

function FieldError({ inputId, message }: { inputId: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <span id={`${inputId}Error`} className={errorTextClass}>
      {message}
    </span>
  );
}

export function GeneralTab() {
  const { draft, errors } = useSettingsDraft();
  const [newWorkspace, setNewWorkspace] = useState('');
  if (!draft) return null;
  const workspaces = draft.workspaces;

  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[#aeb9c8]">Tenant URL</span>
        <input
          id="tenantUrlInput"
          className={fieldInputClass(errors, 'tenantUrl')}
          value={draft.tenantUrl}
          aria-invalid={errors.tenantUrl ? 'true' : undefined}
          onChange={(event) => updateDraft({ tenantUrl: event.target.value })}
          placeholder="https://cloudbeds.devinenterprise.com"
        />
        <FieldError inputId="tenantUrlInput" message={errors.tenantUrl} />
        <span className="text-xs text-[#7f8ca0]">
          Restart not required — Cloud view reloads on tenant change.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[#aeb9c8]">API base</span>
        <input
          id="apiBaseInput"
          className={fieldInputClass(errors, 'apiBase')}
          value={draft.apiBase}
          aria-invalid={errors.apiBase ? 'true' : undefined}
          onChange={(event) => updateDraft({ apiBase: event.target.value })}
          placeholder="https://api.devin.ai"
        />
        <FieldError inputId="apiBaseInput" message={errors.apiBase} />
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-[#aeb9c8]">Workspaces</span>
        <ul className="flex flex-col gap-1 max-w-md">
          {workspaces.map((workspace) => (
            <li key={workspace} className="flex items-center gap-2">
              <span className="flex-1 truncate font-mono text-xs">{workspace}</span>
              <button
                type="button"
                className={saveClass}
                onClick={() =>
                  updateDraft({ workspaces: workspaces.filter((entry) => entry !== workspace) })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 max-w-md">
          <input
            id="workspaceInput"
            className={fieldInputClass(errors, 'workspaces')}
            value={newWorkspace}
            aria-invalid={errors.workspaces ? 'true' : undefined}
            onChange={(event) => setNewWorkspace(event.target.value)}
            placeholder="C:\path\to\workspace"
          />
          <button
            type="button"
            className={saveClass}
            onClick={() => {
              const value = newWorkspace.trim();
              if (value && !workspaces.includes(value)) {
                updateDraft({ workspaces: [...workspaces, value] });
              }
              setNewWorkspace('');
            }}
          >
            Add
          </button>
        </div>
        <FieldError inputId="workspaceInput" message={errors.workspaces} />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[#aeb9c8]">Keep hidden tabs live for (hours, 0 = discard on switch)</span>
        <input
          id="keepAliveInput"
          className={fieldInputClass(errors, 'keepAliveHours')}
          type="number"
          min={0}
          max={168}
          step={1}
          value={draft.keepAliveHours}
          aria-invalid={errors.keepAliveHours ? 'true' : undefined}
          onChange={(event) => updateDraft({ keepAliveHours: event.target.value })}
        />
        <FieldError inputId="keepAliveInput" message={errors.keepAliveHours} />
        <span className="text-xs text-[#7f8ca0]">
          Tabs from other sessions stay live for this long; beyond it they reload on activation.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[#aeb9c8]">Max live tabs</span>
        <input
          id="maxLiveTabsInput"
          className={fieldInputClass(errors, 'maxLiveTabs')}
          type="number"
          min={1}
          max={40}
          step={1}
          value={draft.maxLiveTabs}
          aria-invalid={errors.maxLiveTabs ? 'true' : undefined}
          onChange={(event) => updateDraft({ maxLiveTabs: event.target.value })}
        />
        <FieldError inputId="maxLiveTabsInput" message={errors.maxLiveTabs} />
        <span className="text-xs text-[#7f8ca0]">
          Hard cap on live GitHub pages across all sessions (≈400 MB each); the tab you're looking
          at is exempt.
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          id="terminalAllSurfacesInput"
          type="checkbox"
          checked={draft.terminalAllSurfaces}
          onChange={(event) => updateDraft({ terminalAllSurfaces: event.target.checked })}
        />
        <span>Show terminal dock on Local and Settings too</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[#aeb9c8]">Shell command</span>
        <input
          id="terminalShellInput"
          className={fieldInputClass(errors, 'terminalShell')}
          value={draft.terminalShell}
          aria-invalid={errors.terminalShell ? 'true' : undefined}
          onChange={(event) => updateDraft({ terminalShell: event.target.value })}
          placeholder={
            window.devinworkspaces.platform === 'darwin'
              ? 'e.g. /bin/zsh -l'
              : 'e.g. pwsh.exe or wsl.exe -d Ubuntu'
          }
        />
        <FieldError inputId="terminalShellInput" message={errors.terminalShell} />
        <span className="text-xs text-[#7f8ca0]">
          Blank = Windows Terminal default profile, else PowerShell.
        </span>
      </label>
    </div>
  );
}
