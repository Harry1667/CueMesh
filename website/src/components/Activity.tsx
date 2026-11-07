import { usePreferences } from '../lib/preferences';
import { ArrowUpRight, GitBranch, MessageSquare, Workflow } from 'lucide-react';
import type { TaskEvent } from '../lib/contracts';

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}
export function describeEvent(event: TaskEvent) {
  const p = event.payload;
  switch (event.type) {
    case 'plan':
      return { label: 'Plan shared', detail: text(p.summary) };
    case 'mention':
      return {
        label: `${text(p.fromAgent, 'Agent')} → @${text(p.agent, 'agent')}`,
        detail: text(p.request),
      };
    case 'agent_message':
      return { label: 'Agent update', detail: text(p.text) };
    case 'artifact':
      return { label: 'Artifact added', detail: text(p.name) };
    case 'fallback':
      return {
        label: 'Fallback selected',
        detail: `${text(p.provider)} / ${text(p.model)} — ${text(p.reason)}`,
      };
    case 'browser_result':
      return {
        label:
          p.denied === true
            ? 'Browser action denied'
            : p.ok === true
              ? 'Browser action completed'
              : 'Browser action reported',
        detail: text(p.tool),
      };
    case 'tool_call':
      return { label: 'Tool requested', detail: text(p.tool) };
    case 'run_finished':
      return { label: 'Run finished', detail: text(p.error, text(p.status)) };
    case 'notice':
      return { label: 'Notice', detail: text(p.text) };
    case 'mesh_dispatch':
      return {
        label: 'Device handoff',
        detail: `${text(p.owner)} · ${text(p.device)} — ${text(p.text, text(p.status))}`,
      };
    case 'mesh_report':
      return { label: 'Device report', detail: text(p.text) };
    case 'mesh_question':
      return { label: 'Agent question', detail: text(p.text) };
    case 'mesh_answer':
      return { label: 'Agent answer', detail: text(p.text) };
    case 'task_created':
      return { label: 'Task created', detail: text(p.title) };
    case 'task_update':
      return { label: 'Task updated', detail: text(p.taskId) };
    case 'usage':
      return { label: 'Usage reported', detail: `${text(p.provider)} / ${text(p.model)}` };
    case 'run_update':
      return { label: 'Run updated', detail: 'The extension reported a run state change.' };
  }
}
export function Activity({ events }: { events: TaskEvent[] }) {
  const { t, locale } = usePreferences();

  if (!events.length)
    return (
      <div className="empty-state">
        <Workflow />
        <h3>{t('No activity yet.')}</h3>
      </div>
    );
  return (
    <ol className="activity-timeline">
      {events.map((event) => {
        const entry = describeEvent(event);
        const Icon =
          event.type === 'mention'
            ? GitBranch
            : event.type === 'agent_message'
              ? MessageSquare
              : ArrowUpRight;
        return (
          <li key={`${event.runId}:${event.seq}`}>
            <span className="event-icon">
              <Icon size={15} />
            </span>
            <div>
              <div className="event-heading">
                <strong>{t(entry.label)}</strong>
                <time dateTime={new Date(event.createdAt).toISOString()}>
                  {new Date(event.createdAt).toLocaleTimeString(locale, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              <p>{entry.detail || t('Update received.')}</p>
              <span className="event-sequence">
                {t('EVENT')}
                {String(event.seq).padStart(2, '0')}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
