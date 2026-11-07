import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Folder,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Users,
} from 'lucide-react';
import { AppHeader, type DataMode } from '../components/AppHeader';
import { SignIn } from '../components/SignIn';
import { usePreferences } from '../lib/preferences';
import { useTeamWorkspace } from '../lib/useTeamWorkspace';
import { useAuth } from '../lib/auth';
import { newId } from '../lib/newId';
import { safeSourceUrl } from '../lib/api';
import type { Dispatch, DispatchMessage, RuntimeConfig } from '../lib/contracts';
import '../styles/workspace.css';
import '../styles/team.css';

const statusLabels: Record<Dispatch['status'], string> = {
  pending: 'Awaiting acceptance',
  accepted: 'Accepted',
  rejected: 'Declined',
  done: 'Completed',
  partial: 'Partial result',
  failed: 'Failed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};
type Tab = 'runs' | 'handoffs' | 'context' | 'people';
const runStatusLabel: Record<string, string> = {
  planning: 'Planning',
  running: 'Running',
  done: 'Completed',
  partial: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
type TeamProps = { config: RuntimeConfig; mode: DataMode; setMode: (mode: DataMode) => void };
export function Team(props: TeamProps) {
  const { user } = useAuth();
  return <TeamView key={`${props.mode}:${user?.id ?? 'guest'}`} {...props} />;
}
function TeamView({
  config,
  mode,
  setMode,
}: {
  config: RuntimeConfig;
  mode: DataMode;
  setMode: (mode: DataMode) => void;
}) {
  const { t, locale } = usePreferences();
  const team = useTeamWorkspace(config, mode);
  const [tab, setTab] = useState<Tab>(mode === 'live' ? 'runs' : 'handoffs');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState<'create' | 'join' | null>(null);
  const [invite, setInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const activeProject = useRef(team.project?.id);
  activeProject.current = team.project?.id;
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  useEffect(() => {
    setInvite(null);
    setReplyTo(null);
    setNotice('');
    setError('');
    request.current = null;
  }, [team.project?.id, team.dispatch?.id]);
  const currentUserId = mode === 'demo' ? 'demo-user' : team.user?.id;
  const memberName = (id: string) =>
    team.members.find((member) => member.userId === id)?.displayName ?? t('Project member');
  const targetDevice = team.devices.find(
    (device) => device.id === team.detail?.dispatch.targetDeviceId,
  );
  async function projectForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'demo') {
      setNotice('Connect live to create or join a real project.');
      return;
    }
    const element = event.currentTarget;
    const fields = new FormData(element);
    setPending(true);
    setError('');
    try {
      const result =
        form === 'join'
          ? await team.api.acceptInvite(String(fields.get('code')))
          : await team.api.saveProject(
              newId(),
              String(fields.get('name')),
              String(fields.get('description')),
            );
      team.setSelectedProject(result.project.id);
      setForm(null);
      team.refresh();
      setNotice(form === 'join' ? 'Project joined.' : 'Project created.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The project could not be saved.');
    } finally {
      setPending(false);
    }
  }
  async function createInvite() {
    setError('');
    setNotice('');
    if (mode === 'demo') {
      setNotice('Connect live to create a real invitation.');
      return;
    }
    if (!team.project || team.project.role !== 'owner') return;
    const projectId = team.project.id;
    setPending(true);
    try {
      const result = await team.api.createInvite(projectId);
      if (activeProject.current !== projectId) return;
      setInvite(result);
      setCopied(false);
    } catch (cause) {
      if (activeProject.current === projectId)
        setError(cause instanceof Error ? cause.message : 'The invitation could not be created.');
    } finally {
      setPending(false);
    }
  }
  async function copyInvite() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
    } catch {
      setError('Clipboard access is unavailable. Select and copy the code manually.');
    }
  }
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!team.detail || !currentUserId) return;
    const element = event.currentTarget;
    const fields = new FormData(element);
    const text = String(fields.get('message')).trim();
    if (!text) return;
    const kind = String(fields.get('kind')) as DispatchMessage['kind'];
    const fingerprint = JSON.stringify({ dispatch: team.detail.dispatch.id, kind, text, replyTo });
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: newId() };
    const body = { id: request.current.id, kind, text, replyTo };
    setPending(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'demo') {
        const message: DispatchMessage = {
          ...body,
          dispatchId: team.detail.dispatch.id,
          fromUserId: currentUserId,
          fromDeviceId: null,
          createdAt: Date.now(),
        };
        team.setDetail((current) =>
          current ? { ...current, messages: [...current.messages, message] } : current,
        );
        setNotice('Added to this demo. Nothing was sent to another person or device.');
      } else {
        const result = await team.api.sendMessage(team.detail.dispatch.id, body);
        if (result.message.dispatchId !== team.detail.dispatch.id)
          throw new Error('The server returned another handoff’s messages.');
        team.setDetail((current) =>
          current?.dispatch.id === result.message.dispatchId
            ? {
                ...current,
                messages: [
                  ...new Map(
                    [...current.messages, result.message].map((item) => [item.id, item]),
                  ).values(),
                ],
              }
            : current,
        );
        setNotice('Message saved by the service. Delivery and work status are tracked separately.');
      }
      request.current = null;
      setReplyTo(null);
      element.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The message could not be sent.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#team-main">
        {t('Skip to team workspace')}
      </a>
      <AppHeader mode={mode} onModeChange={setMode} />
      <main id="team-main" className="team-page">
        {mode === 'demo' ? (
          <div className="demo-notice">
            <span className="signal-dot" />
            {t('Demo workspace')} · {t('Sample data')}
          </div>
        ) : null}
        {team.phase === 'signed-out' ? (
          <SignIn />
        ) : team.phase === 'loading' ? (
          <div className="resource-state" role="status">
            {t('Opening the shared workspace…')}
          </div>
        ) : team.phase === 'error' ? (
          <div className="resource-state">
            <h1>{t('Your team is out of reach.')}</h1>
            <p role="alert">{t(team.error)}</p>
            <button className="button button--dark" onClick={team.refresh}>
              {t('Try again')}
              <RefreshCw size={16} />
            </button>
          </div>
        ) : (
          <>
            <div className="team-heading-main">
              <div>
                <h1>{t('Team')}</h1>
              </div>
              <div className="team-actions">
                <button
                  className="button button--outline"
                  onClick={() => {
                    setForm(form === 'join' ? null : 'join');
                    setError('');
                  }}
                >
                  {t('Join project')}
                  <Users size={15} />
                </button>
                <button
                  className="button button--dark"
                  onClick={() => {
                    setForm(form === 'create' ? null : 'create');
                    setError('');
                  }}
                >
                  {t('New project')}
                  <Plus size={15} />
                </button>
              </div>
            </div>
            {form ? (
              <form className="project-form" onSubmit={(event) => void projectForm(event)}>
                <h2>{t(form === 'join' ? 'Join with an invitation' : 'Start a shared project')}</h2>
                {form === 'join' ? (
                  <label>
                    {t('Invitation code')}
                    <input name="code" required autoComplete="off" maxLength={1000} />
                  </label>
                ) : (
                  <>
                    <label>
                      {t('Project name')}
                      <input name="name" required maxLength={120} />
                    </label>
                    <label>
                      {t('Description')}
                      <textarea name="description" maxLength={2000} rows={2} />
                    </label>
                  </>
                )}
                <div className="form-actions">
                  <button className="button button--dark" disabled={pending}>
                    {t(
                      mode === 'demo'
                        ? 'Check live availability'
                        : form === 'join'
                          ? 'Join project'
                          : 'Create project',
                    )}
                    <ArrowRight size={15} />
                  </button>
                  <button type="button" className="quiet-button" onClick={() => setForm(null)}>
                    {t('Cancel')}
                  </button>
                </div>
              </form>
            ) : null}
            {team.error ? (
              <div className="sync-error" role="alert">
                {t(team.error)}
                <button onClick={team.refresh}>
                  {t('Reconnect')}
                  <RefreshCw size={14} />
                </button>
              </div>
            ) : null}
            {team.project ? (
              <div className="team-layout">
                <aside className="team-rail">
                  <span className="eyebrow">{t('PROJECTS')}</span>
                  <nav aria-label={t('Shared projects')}>
                    {[true, false].map((shared) => {
                      const group = team.projects.filter(
                        (item) => (item.memberCount ?? 2) > 1 === shared,
                      );
                      if (!group.length) return null;
                      return (
                        <div key={String(shared)}>
                          {shared ? null : (
                            <span className="eyebrow team-rail-group">
                              {t('PERSONAL PROJECTS')}
                            </span>
                          )}
                          {group.map((project) => (
                            <button
                              key={project.id}
                              aria-current={team.project?.id === project.id ? 'page' : undefined}
                              onClick={() => {
                                team.setSelectedProject(project.id);
                                setInvite(null);
                                setReplyTo(null);
                                setNotice('');
                              }}
                            >
                              <Folder size={16} />
                              <span>
                                {project.name}
                                <small>{t(project.role === 'owner' ? 'Owner' : 'Member')}</small>
                              </span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </nav>
                </aside>
                <section className="team-content">
                  <div className="shared-project-heading">
                    <div>
                      <span className="eyebrow">
                        {t(
                          (team.project.memberCount ?? 2) > 1
                            ? 'SHARED PROJECT'
                            : 'PERSONAL PROJECT',
                        )}
                      </span>
                      <h2>{team.project.name}</h2>
                      <p>{team.project.description}</p>
                    </div>
                    <button
                      className="quiet-button"
                      onClick={team.refresh}
                      aria-label={t('Refresh shared project')}
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  <div className="team-tabs" aria-label={t('Project views')}>
                    {(['runs', 'handoffs', 'context', 'people'] as const).map((value) => (
                      <button
                        key={value}
                        aria-pressed={tab === value}
                        onClick={() => setTab(value)}
                      >
                        {t(
                          value === 'runs'
                            ? 'Task runs'
                            : value === 'handoffs'
                              ? 'Agent handoffs'
                              : value === 'context'
                                ? 'Shared context'
                                : 'People & devices',
                        )}
                        {value === 'runs' ? <span>{team.runs.length}</span> : null}
                        {value === 'handoffs' ? <span>{team.dispatches.length}</span> : null}
                      </button>
                    ))}
                  </div>
                  {tab === 'runs' ? (
                    team.runs.length ? (
                      <ul className="team-run-list">
                        {team.runs.map((run) => (
                          <li key={run.id}>
                            <strong>{run.goal}</strong>
                            <small>
                              {t(runStatusLabel[run.status] ?? 'Completed')} ·{' '}
                              {new Date(run.createdAt).toLocaleString(locale)}
                            </small>
                            {run.finalResult ? <p>{run.finalResult.slice(0, 200)}</p> : null}
                          </li>
                        ))}
                        <li className="team-run-more">
                          <a href="/workspace">{t('Open in workspace')}</a>
                        </li>
                      </ul>
                    ) : (
                      <div className="empty-state">
                        <MessageSquare size={30} />
                        <h3>{t('No task runs yet')}</h3>
                      </div>
                    )
                  ) : tab === 'people' ? (
                    <div className="team-people">
                      <div className="section-heading">
                        <h3>{t('Project members')}</h3>
                        {team.project.role === 'owner' ? (
                          <button
                            className="button button--outline button--small"
                            disabled={pending}
                            onClick={() => void createInvite()}
                          >
                            {t('Invite teammate')}
                            <Plus size={15} />
                          </button>
                        ) : null}
                      </div>
                      {invite ? (
                        <div className="invitation-result">
                          <label>
                            {t('One-use invitation code')}
                            <input readOnly value={invite.code} />
                          </label>
                          <button
                            className="icon-button"
                            onClick={() => void copyInvite()}
                            aria-label={t('Copy invitation code')}
                          >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                          </button>
                          <p>
                            {t('Expires {date}', {
                              date: new Date(invite.expiresAt).toLocaleString(locale),
                            })}
                          </p>
                        </div>
                      ) : null}
                      {team.members.map((member) => (
                        <div className="member-row" key={member.userId}>
                          <span className="member-avatar">{member.displayName.slice(0, 1)}</span>
                          <div>
                            <strong>
                              {member.displayName}
                              {member.userId === currentUserId ? ` · ${t('You')}` : ''}
                            </strong>
                            <small>{member.email}</small>
                          </div>
                          <span className="state-pill">
                            {t(member.role === 'owner' ? 'Owner' : 'Member')}
                          </span>
                        </div>
                      ))}
                      <h3 className="devices-title">{t('Project devices')}</h3>
                      {team.devices
                        .filter((device) =>
                          team.members.some((member) => member.userId === device.userId),
                        )
                        .map((device) => (
                          <div className="device-row" key={device.id}>
                            <div>
                              <strong>{device.name}</strong>
                              <span>
                                {device.ownerName} · {device.platform}
                              </span>
                              <small>
                                {t(
                                  device.acceptRemote === 'off'
                                    ? 'Remote requests are off'
                                    : device.acceptRemote === 'auto'
                                      ? 'Own-account requests can be accepted automatically'
                                      : 'Requests need approval',
                                )}
                              </small>
                            </div>
                            <span
                              className={`state-pill ${device.online ? 'state-pill--online' : ''}`}
                            >
                              {t(device.online ? 'Online' : 'Offline')}
                            </span>
                          </div>
                        ))}
                      <p className="account-footnote">
                        {t(
                          'Online means connected, not necessarily working. Cross-account tasks always require the receiving person’s approval.',
                        )}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="handoff-select">
                        <label htmlFor="handoff-select">{t('Selected handoff')}</label>
                        <select
                          id="handoff-select"
                          value={team.dispatch?.id ?? ''}
                          disabled={!team.dispatches.length}
                          onChange={(event) => {
                            team.setSelectedDispatch(event.target.value);
                            setReplyTo(null);
                          }}
                        >
                          {team.dispatches.length ? (
                            team.dispatches.map((dispatch) => (
                              <option value={dispatch.id} key={dispatch.id}>
                                {dispatch.goal}
                              </option>
                            ))
                          ) : (
                            <option value="">{t('No handoffs yet')}</option>
                          )}
                        </select>
                      </div>
                      {!team.dispatch ? (
                        <div className="empty-state">
                          <MessageSquare size={30} />
                          <h3>{t('No handoffs yet')}</h3>
                        </div>
                      ) : !team.detail ? (
                        <div className="resource-state" role="status">
                          {t('Loading this handoff…')}
                        </div>
                      ) : tab === 'context' ? (
                        <div className="shared-context">
                          <span className="eyebrow">{t('CONTEXT SHARED WITH THIS HANDOFF')}</span>
                          <h3>{team.detail.dispatch.goal}</h3>
                          {team.detail.dispatch.context.length ? (
                            team.detail.dispatch.context.map((context, index) => {
                              const url =
                                typeof context.url === 'string' ? safeSourceUrl(context.url) : null;
                              return (
                                <article key={index}>
                                  <h4>
                                    {typeof context.title === 'string'
                                      ? context.title
                                      : t('Shared excerpt')}
                                  </h4>
                                  <p>
                                    {typeof context.text === 'string'
                                      ? context.text
                                      : t('This context item has no text preview.')}
                                  </p>
                                  {url ? (
                                    <a href={url} target="_blank" rel="noopener noreferrer">
                                      {t('Open source')}
                                      <ArrowUpRight size={14} />
                                    </a>
                                  ) : null}
                                </article>
                              );
                            })
                          ) : (
                            <p>{t('No context excerpt was shared.')}</p>
                          )}
                        </div>
                      ) : (
                        <div className="handoff-detail">
                          <div className="handoff-summary">
                            <span
                              className={`state-pill state-pill--${team.detail.dispatch.status}`}
                            >
                              {t(statusLabels[team.detail.dispatch.status])}
                            </span>
                            <h3>{team.detail.dispatch.goal}</h3>
                            <div className="handoff-owners">
                              <span>{team.detail.dispatch.senderName}</span>
                              <ArrowRight size={15} />
                              <span>
                                {targetDevice?.ownerName ??
                                  memberName(team.detail.dispatch.targetUserId)}
                              </span>
                              <small>
                                {t(targetDevice?.online ? 'Device online' : 'Device offline')}
                              </small>
                            </div>
                            <dl>
                              <div>
                                <dt>{t('Requested budget')}</dt>
                                <dd>${team.detail.dispatch.options.maxCostUsd.toFixed(2)}</dd>
                              </div>
                              <div>
                                <dt>{t('Reported estimate')}</dt>
                                <dd>${team.detail.dispatch.costUsd.toFixed(4)}</dd>
                              </div>
                            </dl>
                            {team.detail.dispatch.summary ? (
                              <p>{team.detail.dispatch.summary}</p>
                            ) : null}
                            {team.detail.dispatch.error ? (
                              <p className="form-message">{team.detail.dispatch.error}</p>
                            ) : null}
                            {team.detail.dispatch.result ? (
                              <div className="handoff-result">
                                <strong>{t('Result')}</strong>
                                <p>{team.detail.dispatch.result}</p>
                              </div>
                            ) : null}
                          </div>
                          <div className="conversation-heading">
                            <h3>{t('Questions, answers, progress.')}</h3>
                            <span>{t('Visible to the handoff participants')}</span>
                          </div>
                          <ol className="handoff-messages">
                            {team.detail.messages.map((message) => (
                              <li
                                key={message.id}
                                className={
                                  message.fromUserId === currentUserId ? 'message--mine' : ''
                                }
                              >
                                <div>
                                  <strong>{memberName(message.fromUserId)}</strong>
                                  <span>
                                    {t(
                                      message.kind === 'question'
                                        ? 'Question'
                                        : message.kind === 'answer'
                                          ? 'Answer'
                                          : 'Progress',
                                    )}
                                  </span>
                                  <time dateTime={new Date(message.createdAt).toISOString()}>
                                    {new Date(message.createdAt).toLocaleTimeString(locale, {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </time>
                                </div>
                                <p>{message.text}</p>
                                <button
                                  className="quiet-button"
                                  onClick={() => {
                                    setReplyTo(message.id);
                                    document.getElementById('team-message')?.focus();
                                  }}
                                >
                                  {t('Reply')}
                                  <ArrowUpRight size={13} />
                                </button>
                              </li>
                            ))}
                          </ol>
                          <form
                            className="message-composer"
                            onSubmit={(event) => void sendMessage(event)}
                          >
                            {replyTo ? (
                              <div className="reply-label">
                                {t('Replying to a message')}
                                <button type="button" onClick={() => setReplyTo(null)}>
                                  {t('Cancel')}
                                </button>
                              </div>
                            ) : null}
                            <label htmlFor="team-message">{t('Keep the work connected')}</label>
                            <textarea
                              id="team-message"
                              name="message"
                              rows={3}
                              required
                              maxLength={20000}
                              placeholder={t('Ask a question or share a concise progress update…')}
                            />
                            <div>
                              <select
                                name="kind"
                                aria-label={t('Message type')}
                                defaultValue="question"
                              >
                                <option value="question">{t('Question')}</option>
                                <option value="answer">{t('Answer')}</option>
                                <option value="progress">{t('Progress')}</option>
                              </select>
                              <button className="button button--dark" disabled={pending}>
                                {t(
                                  pending
                                    ? 'Saving…'
                                    : mode === 'demo'
                                      ? 'Add demo message'
                                      : 'Send message',
                                )}
                                <Send size={15} />
                              </button>
                            </div>
                            <p>
                              {t(
                                'Messages share context. They do not approve browser actions or prove work is complete.',
                              )}
                            </p>
                          </form>
                        </div>
                      )}
                    </>
                  )}
                </section>
              </div>
            ) : (
              <div className="empty-state">
                <Users size={30} />
                <h2>{t('A place for your next shared project.')}</h2>
                <p>{t('Create a project or join with a code from your teammate.')}</p>
              </div>
            )}
          </>
        )}
        {notice ? (
          <p className="success-notice" role="status">
            {t(notice)}
          </p>
        ) : null}
        {error ? (
          <p className="form-message" role="alert">
            {t(error)}
          </p>
        ) : null}
      </main>
    </div>
  );
}
