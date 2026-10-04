import type { KeyboardEvent } from 'react';
import type { SettingsTabId } from '../../../core/settingsDraft';

const TABS: { id: SettingsTabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'links', label: 'Link Handling' },
  { id: 'passwords', label: 'Passwords' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'updates', label: 'Updates' },
];

export const SETTINGS_TAB_IDS = TABS.map((tab) => tab.id);

interface SettingsTabsProps {
  active: SettingsTabId;
  onSelect: (id: SettingsTabId) => void;
}

export function SettingsTabs({ active, onSelect }: SettingsTabsProps) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = SETTINGS_TAB_IDS.indexOf(active);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next =
      SETTINGS_TAB_IDS[(index + delta + SETTINGS_TAB_IDS.length) % SETTINGS_TAB_IDS.length];
    if (next && next !== active) onSelect(next);
  };

  return (
    <div id="settingsTabs" role="tablist" className="flex gap-1 mb-6" onKeyDown={onKeyDown}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          id={`settingsTab-${tab.id}`}
          role="tab"
          data-settings-tab={tab.id}
          aria-selected={active === tab.id}
          type="button"
          className="px-3 py-1.5 rounded-md border border-[#39475a] bg-[#1a2330] hover:bg-[#2a394d] text-sm aria-selected:bg-[#31455f] aria-selected:border-[#54749c]"
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
