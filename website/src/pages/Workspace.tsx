import { usePreferences } from '../lib/preferences';
import { useState, useRef } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Chrome,
  CircleDot,
  Code2,
  FileText,
  Folder,
  GitBranch,
  Layers3,
  LoaderCircle,
  LogOut,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import { AppHeader, type DataMode } from '../components/AppHeader';
import { SignIn } from '../components/SignIn';
import { useAuth } from '../lib/auth';
import { Link } from '../components/Link';
import { Status } from '../components/Status';
import { Activity } from '../components/Activity';
import { ArtifactViewer } from '../components/ArtifactViewer';
import { RunPicker } from '../components/RunPicker';
import { ModelLineup } from '../components/ModelLineup';
import { demoModelRouting, modelLabel } from '../data/modelRouting';
import { useWorkspace } from '../lib/useWorkspace';
import { safeSourceUrl } from '../lib/api';
import { RunTabs, type RunTab } from '../components/RunTabs';
import type { Agent, RuntimeConfig, Task } from '../lib/contracts';
import '../styles/workspace.css';

const icons: Record<Agent, typeof Search> = {
  research: Search,
  coding: Code2,
  '3d': Layers3,
  vision: Search,
  planning: Waypoints,
  review: ShieldCheck,
  browser: Chrome,
};
const providers = { gemini: 'Google', anthropic: 'Anthropic', openai: 'OpenAI' };

export function Workspace({
  config,
  mode,
  setMode,
}: {
  config: RuntimeConfig;
  mode: DataMode;
  setMode: (mode: DataMode) => void;
}) {
  return <WorkspaceView key={mode} config={config} mode={mode} setMode={setMode} />;
}

function WorkspaceView({
  config,
  mode,
  setMode,
}: {
  config: RuntimeConfig;
  mode: 'demo' | 'live';
  setMode: (mode: 'demo' | 'live') => void;
}) {
  const { t, locale } = usePreferences();

  const workspace = useWorkspace(config, mode);
  const auth = useAuth();
  const inspector = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<RunTab>('overview');
  const [query, setQuery] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState('');
  const project = workspace.projects.find((item) => item.id === workspace.projectId);
  const detail = workspace.detail;
  const task = detail?.tasks.find((item) => item.id === taskId) ?? null;
  const selectedRun = detail?.run ?? workspace.runs.find((item) => item.id === workspace.runId);
  const filteredProjects = workspace.projects.filter((item) =>
    (item.name + ' ' + item.description).toLowerCase().includes(query.toLowerCase()),
  );
  const completed = detail?.tasks.filter((item) => item.status === 'done').length ?? 0;

  async function logout() {
    setAuthPending(true);
    setAuthError('');
    try {
      await auth.logout();
    } catch {
      setAuthError('Signed out here. The service could not confirm server-side revocation.');
    } finally {
      setAuthPending(false);
    }
  }
  function selectTask(id: string) {
    const next = taskId === id ? null : id;
    setTaskId(next);
    if (next && matchMedia('(max-width:980px)').matches)
      requestAnimationFrame(() => {
        inspector.current?.focus({ preventScroll: true });
        inspector.current?.scrollIntoView({
          block: 'start',
          behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth',
        });
      });
  }

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-main">
        {t('Skip to workspace')}
      </a>
      <AppHeader mode={mode} onModeChange={setMode} />
      <div className="workspace-grid">
        <aside className="project-sidebar">
          <div className="sidebar-section-label">{t('YOUR WORK')}</div>
          <div className="sidebar-current">
            <Waypoints size={17} />
            <span>{t('Project workspace')}</span>
            <span className="sidebar-current-dot" />
          </div>
          <label className="project-search">
            <Search size={14} />
            <input
              aria-label={t('Search projects')}
              placeholder={t('Find a project')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="sidebar-project-heading">
            <span>{t('PROJECTS')}</span>
            <span>{workspace.projects.length.toString().padStart(2, '0')}</span>
          </div>
          <nav aria-label={t('Projects')} className="project-links">
            {filteredProjects.map((item) => (
              <button
                key={item.id}
                className={item.id === workspace.projectId ? 'selected' : ''}
                onClick={() => {
                  workspace.setProjectId(item.id);
                  setTaskId(null);
                  setTab('overview');
                }}
                aria-current={item.id === workspace.projectId ? 'page' : undefined}
              >
                <Folder size={15} />
                <span>{item.name}</span>
                <ArrowUpRight size={13} />
              </button>
            ))}
            {query && !filteredProjects.length ? (
              <p className="sidebar-empty">{t('No matching projects.')}</p>
            ) : null}
          </nav>
          <div className="sidebar-bottom">
            <a href={config.extensionInstallUrl} target="_blank" rel="noopener noreferrer">
              <Chrome size={17} />
              <span>Chrome</span>
              <ArrowUpRight size={14} />
            </a>
            <Link href="/">
              <ArrowLeft size={17} />
              {t('About CueMesh')}
            </Link>
            <div className="workspace-user">
              <span>
                {mode === 'demo' ? 'Y' : (workspace.session?.user?.name.charAt(0) ?? 'C')}
              </span>
              <div>
                {mode === 'demo'
                  ? t('Your workspace')
                  : (workspace.session?.user?.name ?? 'CueMesh')}
                <small>{t(mode === 'demo' ? 'Sample data' : 'Personal account')}</small>
              </div>
              {mode === 'live' && workspace.session?.user ? (
                <button
                  className="icon-button"
                  disabled={authPending}
                  aria-label={t('Sign out')}
                  onClick={() => void logout()}
                >
                  <LogOut size={15} />
                </button>
              ) : null}
            </div>
          </div>
        </aside>
        <main id="workspace-main" className="workspace-main">
          <div className="workspace-topline">
            <span className="eyebrow">
              {t('WORKSPACE')}
              <span>/</span> {project?.name ?? t('YOUR PROJECTS')}
            </span>
            <button
              className="quiet-button"
              onClick={workspace.retry}
              disabled={workspace.phase === 'loading'}
            >
              <RefreshCw size={13} />
              {t('Refresh')}
            </button>
          </div>
          {mode === 'demo' ? (
            <div className="demo-notice">
              <span className="signal-dot" />
              <p>
                {t('Demo workspace')} · {t('Sample data')}
              </p>
            </div>
          ) : null}
          {workspace.phase === 'loading' ? (
            <div className="workspace-loading" role="status">
              <LoaderCircle size={26} />
              <h1>{t('Opening your workspace.')}</h1>
            </div>
          ) : workspace.phase === 'error' ? (
            <div className="connection-empty">
              <Radio size={28} />
              <span className="eyebrow">{t('LIVE SYNC IS NOT AVAILABLE')}</span>
              <h1>
                {t('Your work is')}
                <br />
                {t('out of reach.')}
              </h1>
              <p role="alert">{t(workspace.error)}</p>
              <div>
                <button className="button button--dark" onClick={workspace.retry}>
                  {t('Try again')}
                  <RefreshCw size={15} />
                </button>
                <button className="button button--outline" onClick={() => setMode('demo')}>
                  {t('Explore sample workspace')}
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          ) : workspace.phase === 'signed-out' ? (
            <SignIn onSignedIn={workspace.retry} />
          ) : !project ? (
            <div className="empty-state empty-state--large">
              <Folder size={30} />
              <h1>{t('No projects yet')}</h1>
              <Link className="button button--dark" href="/team">
                {t('New project')}
                <ArrowUpRight size={16} />
              </Link>
            </div>
          ) : (
            <>
              <div className="project-title">
                <div>
                  <h1>
                    {project.name}
                    <span>↗</span>
                  </h1>
                </div>
              </div>
              <div className="run-selector">
                <RunPicker
                  key={project.id}
                  runs={workspace.runs}
                  value={workspace.runId}
                  loading={workspace.runsLoading}
                  onChange={(id) => {
                    workspace.setRunId(id);
                    setTaskId(null);
                  }}
                />
                {selectedRun ? <Status status={selectedRun.status} /> : null}
              </div>
              {workspace.syncError ? (
                <div className="sync-error" role="alert">
                  <span>
                    {t(workspace.syncError)}{' '}
                    {detail ? t('The last received snapshot remains visible.') : ''}
                  </span>
                  <button onClick={workspace.retry}>
                    {t('Reconnect')}
                    <RefreshCw size={12} />
                  </button>
                </div>
              ) : null}
              {workspace.detailLoading ? (
                <div className="detail-loading" role="status">
                  <LoaderCircle size={18} />
                  {t('Loading this run…')}
                </div>
              ) : detail ? (
                <>
                  <RunTabs
                    value={tab}
                    onChange={setTab}
                    eventCount={detail.events.length}
                    artifactCount={detail.artifacts.length}
                  />
                  <section
                    id={`panel-${tab}`}
                    role="tabpanel"
                    aria-labelledby={`tab-${tab}`}
                    className="run-panel"
                    key={`${detail.run.id}-${tab}`}
                  >
                    {tab === 'overview' ? (
                      <>
                        <div className="goal-heading">
                          <span className="section-kicker">
                            <CircleDot size={14} />
                            {t('Task')}
                          </span>
                          <span className="run-mode">{detail.run.mode}</span>
                        </div>
                        <h2 className="run-goal">{detail.run.goal}</h2>
                        <div className="team-heading">
                          <h3>{t('Agents')}</h3>
                          <span>
                            {completed} / {detail.tasks.length} · {t('Completed')}
                          </span>
                        </div>
                        <div className="task-path">
                          {detail.tasks.map((item, index) => (
                            <TaskCard
                              task={item}
                              index={index}
                              selected={taskId === item.id}
                              onSelect={() => selectTask(item.id)}
                              key={item.id}
                            />
                          ))}
                        </div>
                        {mode === 'demo' ? <ModelLineup /> : null}
                        <div className="result-section">
                          <div className="result-label">
                            <span className="result-symbol">
                              <ArrowDownLeft size={19} />
                            </span>
                            <div>
                              <h3>{t('Result')}</h3>
                            </div>
                          </div>
                          {detail.run.finalResult ? (
                            <div className="result-text">
                              <p>{detail.run.finalResult.split('\n\n')[0]}</p>
                              {detail.run.finalResult.includes('\n\n') ? (
                                <details className="compact-details">
                                  <summary>{t('Read more')}</summary>
                                  {detail.run.finalResult
                                    .split('\n\n')
                                    .slice(1)
                                    .map((paragraph, index) => (
                                      <p key={index}>{paragraph}</p>
                                    ))}
                                </details>
                              ) : null}
                            </div>
                          ) : (
                            <p className="result-text">{t('No result yet')}</p>
                          )}
                          {detail.run.error ? (
                            <p className="result-error">{detail.run.error}</p>
                          ) : null}
                          {detail.artifacts.length ? (
                            <button
                              className="artifact-shortcut"
                              onClick={() => setTab('artifacts')}
                            >
                              <FileText size={19} />
                              <span>
                                <strong>{detail.artifacts[0].name}</strong>
                                <small>
                                  {t('Files attached: {count}', { count: detail.artifacts.length })}
                                </small>
                              </span>
                              <ArrowUpRight size={20} />
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : tab === 'activity' ? (
                      <Activity events={detail.events} />
                    ) : (
                      <ArtifactViewer artifacts={detail.artifacts} />
                    )}
                  </section>
                </>
              ) : !workspace.runsLoading && !workspace.runs.length ? (
                <div className="empty-state">
                  <GitBranch size={28} />
                  <h2>{t('No runs yet')}</h2>
                </div>
              ) : null}
            </>
          )}
          {authError && workspace.phase !== 'signed-out' ? (
            <p className="form-message" role="alert">
              {t(authError)}
            </p>
          ) : null}
        </main>
        <aside
          id="run-inspector"
          ref={inspector}
          tabIndex={-1}
          className="run-inspector"
          aria-label={t('Run details')}
        >
          <div className="inspector-title">
            <span>{t(task ? 'AGENT DETAIL' : 'IN FOCUS')}</span>
            <Waypoints size={15} />
          </div>
          {task ? (
            <TaskInspector
              task={task}
              onClose={() => {
                setTaskId(null);
                document.getElementById('task-' + task.id)?.focus();
              }}
            />
          ) : (
            <>
              <h2>{t('Run details')}</h2>
              {project?.description ? (
                <p className="inspector-description">{project.description}</p>
              ) : null}
              {detail ? (
                <>
                  <dl className="run-facts">
                    <div>
                      <dt>{t('Run status')}</dt>
                      <dd>
                        <Status status={detail.run.status} />
                      </dd>
                    </div>
                    <div>
                      <dt>{t('Mode')}</dt>
                      <dd>{detail.run.mode}</dd>
                    </div>
                    <div>
                      <dt>{t('Started')}</dt>
                      <dd>
                        {new Date(detail.run.createdAt).toLocaleString(locale, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('Estimated usage')}</dt>
                      <dd>${detail.run.costUsd.toFixed(4)}</dd>
                    </div>
                    <div>
                      <dt>{t('Tokens in / out')}</dt>
                      <dd>
                        {detail.run.inputTokens.toLocaleString(locale)} /{' '}
                        {detail.run.outputTokens.toLocaleString(locale)}
                      </dd>
                    </div>
                  </dl>
                  <p className="usage-caption">
                    {t(
                      mode === 'demo'
                        ? 'Illustrative usage values. No charges occurred.'
                        : 'Cost is a reported estimate, not a billing statement.',
                    )}
                  </p>
                  {detail.run.planSummary ? (
                    <section className="inspector-plan">
                      <h3>{t('Plan')}</h3>
                      <p>{detail.run.planSummary}</p>
                    </section>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  index,
  selected,
  onSelect,
}: {
  task: Task;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = usePreferences();
  const Icon = icons[task.agent];
  return (
    <button
      className={`task-card ${selected ? 'task-card--selected' : ''}`}
      onClick={onSelect}
      id={'task-' + task.id}
      aria-controls="run-inspector"
      aria-pressed={selected}
    >
      <span className="task-card-top">
        <span>{String(index + 1).padStart(2, '0')}</span>
        <Icon size={18} />
      </span>
      <strong>{t(demoModelRouting[task.agent].label)}</strong>
      <span className="task-model" title={task.model}>
        {modelLabel(task.model)}
      </span>
      <span className="task-card-bottom">
        <Status status={task.status} />
        <ArrowUpRight size={14} />
      </span>
    </button>
  );
}

function TaskInspector({ task, onClose }: { task: Task; onClose: () => void }) {
  const { t } = usePreferences();

  const Icon = icons[task.agent];
  return (
    <div className="task-inspector">
      <button className="quiet-button" onClick={onClose}>
        <ArrowLeft size={13} />
        {t('Run details')}
      </button>
      <span className="inspector-agent-icon">
        <Icon size={25} />
      </span>
      <span className="section-kicker">@{task.agent}</span>
      <h2>{task.title}</h2>
      <Status status={task.status} />
      <dl className="run-facts">
        <div>
          <dt>{t('Provider')}</dt>
          <dd>{providers[task.provider]}</dd>
        </div>
        <div>
          <dt>{t('Model')}</dt>
          <dd>{task.model}</dd>
        </div>
        <div>
          <dt>{t('Delegation')}</dt>
          <dd>{t(task.parentTaskId ? 'Delegated by another task' : 'Top-level task')}</dd>
        </div>
      </dl>
      {task.result ? (
        <>
          <h3>{t('Agent result')}</h3>
          <p className="task-result">{task.result}</p>
        </>
      ) : null}
      {task.error ? <p className="result-error">{task.error}</p> : null}
      <h3>{t('Sources')}</h3>
      {task.sources.length ? (
        task.sources.map((source, index) => {
          const url = safeSourceUrl(source.url);
          return url ? (
            <a
              className="source-link"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              key={`${url}-${index}`}
            >
              <BookOpen size={14} />
              {source.title}
              <ArrowUpRight size={13} />
            </a>
          ) : (
            <p className="usage-caption" key={index}>
              {t('A source link was omitted because its URL is invalid.')}
            </p>
          );
        })
      ) : (
        <p className="usage-caption">{t('No sources were reported for this task.')}</p>
      )}
    </div>
  );
}
