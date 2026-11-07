import { usePreferences } from '../lib/preferences';
import { Check, Circle, CircleAlert, LoaderCircle, Minus } from 'lucide-react';

export function Status({ status }: { status: string }) {
  const { t } = usePreferences();
  const label: Record<string, string> = {
    done: 'Completed',
    running: 'Running',
    planning: 'Planning',
    pending: 'Pending',
    partial: 'Partial result',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  const Icon =
    status === 'done'
      ? Check
      : status === 'failed' || status === 'partial'
        ? CircleAlert
        : status === 'running' || status === 'planning'
          ? LoaderCircle
          : status === 'cancelled'
            ? Minus
            : Circle;
  return (
    <span className={`status status--${status}`}>
      <Icon size={12} aria-hidden="true" />
      {t(label[status] ?? status)}
    </span>
  );
}
