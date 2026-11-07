import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, History } from 'lucide-react';
import type { Run } from '../lib/contracts';
import { usePreferences } from '../lib/preferences';
import { Status } from './Status';

export function RunPicker({
  runs,
  value,
  loading,
  onChange,
}: {
  runs: Run[];
  value: string;
  loading: boolean;
  onChange: (id: string) => void;
}) {
  const { t, locale } = usePreferences();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const selected = runs.findIndex((run) => run.id === value);
  const label = (index: number) =>
    t('Run {number}', {
      number: String(runs.length - index).padStart(2, '0'),
    });

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function navigate(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const items = Array.from(
      root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [],
    );
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % items.length
            : event.key === 'ArrowUp'
              ? (index - 1 + items.length) % items.length
              : -1;
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  return (
    <div
      className="run-picker"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={navigate}
    >
      <button
        ref={trigger}
        type="button"
        className="run-picker-trigger"
        disabled={!runs.length || loading}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${t('CURRENT RUN')}: ${selected >= 0 ? label(selected) : t('No runs yet')}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <History size={15} aria-hidden="true" />
        <span>
          {loading ? t('Loading runs…') : selected >= 0 ? label(selected) : t('No runs yet')}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="run-picker-menu" id={menuId} role="menu" aria-label={t('Runs')}>
          {runs.map((run, index) => (
            <button
              key={run.id}
              type="button"
              role="menuitemradio"
              aria-checked={run.id === value}
              tabIndex={-1}
              onClick={() => {
                onChange(run.id);
                close();
              }}
            >
              <span className="run-picker-check">
                {run.id === value ? <Check size={15} /> : null}
              </span>
              <span className="run-picker-item">
                <span className="run-picker-meta">
                  <strong>{label(index)}</strong>
                  <time dateTime={new Date(run.createdAt).toISOString()}>
                    {new Date(run.createdAt).toLocaleDateString(locale, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                </span>
                <span className="run-picker-goal">{run.goal}</span>
                <Status status={run.status} />
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
