import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { ArrowRight } from 'lucide-react';
import { Landing } from './pages/Landing';
import { Link, usePath } from './components/Link';
import { RuntimeConfigSchema, type RuntimeConfig } from './lib/contracts';
import { AuthProvider } from './lib/auth';
import { usePreferences } from './lib/preferences';
import type { DataMode } from './components/AppHeader';
const Workspace = lazy(() =>
  import('./pages/Workspace').then((module) => ({ default: module.Workspace })),
);
const Team = lazy(() => import('./pages/Team').then((module) => ({ default: module.Team })));
const Account = lazy(() =>
  import('./pages/Account').then((module) => ({ default: module.Account })),
);

export function App() {
  const path = usePath();
  const { t } = usePreferences();
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [mode, setMode] = useState<DataMode | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let unmounted = false;
    void fetch(`${import.meta.env.BASE_URL}runtime-config.json`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Connection settings could not be loaded.');
        const result = RuntimeConfigSchema.safeParse(await response.json());
        if (!result.success) throw new Error('Connection settings are invalid.');
        if (!unmounted) setConfig(result.data);
      })
      .catch((error) => {
        if (!unmounted)
          setConfigError(
            error instanceof Error && error.name !== 'AbortError'
              ? error.message
              : 'Connection settings took too long to load.',
          );
      })
      .finally(() => clearTimeout(timer));
    return () => {
      unmounted = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    document.title =
      path === '/workspace'
        ? `${t('Workspace')} — CueMesh`
        : path === '/team'
          ? `${t('Team')} — CueMesh`
          : path === '/account'
            ? `${t('Account')} — CueMesh`
            : 'CueMesh — One cue. Every AI.';
  }, [path, t]);
  if (!config) {
    if (path === '/') return <Landing />;
    return (
      <div className="page-message">
        <h1>
          {t(configError ? 'The workspace could not be prepared.' : 'Preparing the workspace…')}
        </h1>
        {configError ? (
          <>
            <p role="alert">{t(configError)}</p>
            <button className="button button--dark" onClick={() => window.location.reload()}>
              {t('Try again')}
            </button>
          </>
        ) : null}
      </div>
    );
  }
  const props = { config, mode: mode ?? config.dataMode, setMode };
  return (
    <AuthProvider config={config}>
      {path === '/' ? (
        <Landing />
      ) : (
        <Suspense
          fallback={
            <div className="page-message" role="status">
              {t('Opening the workspace…')}
            </div>
          }
        >
          {path === '/workspace' ? (
            <Workspace {...props} />
          ) : path === '/team' ? (
            <Team {...props} />
          ) : path === '/account' ? (
            <Account {...props} />
          ) : (
            <div className="page-message">
              <span className="eyebrow">404</span>
              <h1>{t('This path hasn’t been connected.')}</h1>
              <Link className="button button--dark" href="/">
                {t('Back to CueMesh')}
                <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </Suspense>
      )}
    </AuthProvider>
  );
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CueMesh interface error', error.message, info.componentStack);
  }
  render() {
    return this.state.failed ? (
      <div className="page-message">
        <h1>The view could not be opened.</h1>
        <p>Reload this page to reconnect.</p>
        <button className="button button--dark" onClick={() => window.location.reload()}>
          Reload CueMesh
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
