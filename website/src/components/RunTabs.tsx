import { usePreferences } from '../lib/preferences';
import type { KeyboardEvent } from 'react';

export type RunTab = 'overview' | 'activity' | 'artifacts';
const tabs: RunTab[] = ['overview', 'activity', 'artifacts'];

export function RunTabs({
  value,
  onChange,
  eventCount,
  artifactCount,
}: {
  value: RunTab;
  onChange: (tab: RunTab) => void;
  eventCount: number;
  artifactCount: number;
}) {
  const { t } = usePreferences();

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next]);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }
  return (
    <div className="run-tabs" role="tablist" aria-label={t('Run views')}>
      {tabs.map((tab, index) => (
        <button
          role="tab"
          id={`tab-${tab}`}
          aria-selected={value === tab}
          aria-controls={`panel-${tab}`}
          tabIndex={value === tab ? 0 : -1}
          key={tab}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => moveFocus(event, index)}
        >
          {t(tab === 'overview' ? 'Overview' : tab === 'activity' ? 'Activity' : 'Artifacts')}
          {tab === 'artifacts' ? (
            <span>{artifactCount}</span>
          ) : tab === 'activity' ? (
            <span>{eventCount}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
