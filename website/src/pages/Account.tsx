import { useEffect, useState } from 'react';
import { ArrowUpRight, Laptop, LogOut, ShieldCheck, Users } from 'lucide-react';
import { AppHeader, type DataMode } from '../components/AppHeader';
import { SignIn } from '../components/SignIn';
import { Link } from '../components/Link';
import { ConnectionDialog } from '../components/ConnectionDialog';
import { useAuth } from '../lib/auth';
import { usePreferences } from '../lib/preferences';
import type { Device, RuntimeConfig } from '../lib/contracts';
import { demoDevices } from '../data/teamDemo';
import '../styles/workspace.css';
import '../styles/team.css';

export function Account({
  config,
  mode,
  setMode,
}: {
  config: RuntimeConfig;
  mode: DataMode;
  setMode: (mode: DataMode) => void;
}) {
  const { t, locale } = usePreferences();
  const auth = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setDevices([]);
    setError('');
    if (mode === 'demo') {
      setDevices(demoDevices.filter((device) => device.mine));
      return () => controller.abort();
    }
    if (!auth.user) return () => controller.abort();
    void auth.api
      .devices(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted)
          setDevices(response.devices.filter((device) => device.mine));
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not load your devices.');
      });
    return () => controller.abort();
  }, [auth.api, auth.user, mode]);
  async function logout() {
    setPending(true);
    setError('');
    try {
      await auth.logout();
    } catch {
      setError('Signed out here. The service could not confirm server-side revocation.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#account-main">
        {t('Skip to account')}
      </a>
      <AppHeader mode={mode} onModeChange={setMode} />
      <main id="account-main" className="account-page">
        {mode === 'demo' ? (
          <div className="demo-notice">
            <span className="signal-dot" />
            {t('Demo workspace')} · {t('Sample data')}
          </div>
        ) : null}
        {mode === 'live' && !auth.user ? (
          <div className="account-welcome">
            <SignIn />
            <aside className="account-story">
              <Users size={30} />
              <h2>{t('One brief. Different strengths.')}</h2>
              <p>
                {t(
                  'Share a project, follow each person’s progress, and keep questions and answers with the work.',
                )}
              </p>
              <Link href="/team" className="text-link">
                {t('Open team workspace')}
                <ArrowUpRight size={18} />
              </Link>
            </aside>
          </div>
        ) : (
          <>
            <div className="account-heading">
              <div>
                <span className="eyebrow">{t('YOUR CUEMESH ACCOUNT')}</span>
                <h1>{mode === 'demo' ? 'Ethan' : auth.user?.displayName}</h1>
                <p>{mode === 'demo' ? t('Sample account') : auth.user?.email}</p>
              </div>
              {mode === 'demo' ? (
                <button className="button button--dark" onClick={() => setMode('live')}>
                  {t('Sign in or create account')}
                  <ArrowUpRight size={16} />
                </button>
              ) : (
                <button
                  className="button button--outline"
                  disabled={pending}
                  onClick={() => void logout()}
                >
                  {t('Sign out')}
                  <LogOut size={16} />
                </button>
              )}
            </div>
            <div className="account-sections">
              <section className="account-section">
                <div className="section-heading">
                  <h2>{t('Team')}</h2>
                  <ShieldCheck size={20} />
                </div>
                <Link href="/team" className="text-link">
                  {t('Open team workspace')}
                  <ArrowUpRight size={16} />
                </Link>
              </section>
              <section className="account-section">
                <div className="section-heading">
                  <h2>{t('Your devices')}</h2>
                  <Laptop size={20} />
                </div>
                {devices.length ? (
                  devices.map((device) => (
                    <div className="account-row" key={device.id}>
                      <div>
                        <strong>{device.name}</strong>
                        <span>
                          {device.platform} ·{' '}
                          {device.lastSeenAt
                            ? new Date(device.lastSeenAt).toLocaleString(locale)
                            : t('Never synced')}
                        </span>
                      </div>
                      <span className="state-pill">{t(device.online ? 'Online' : 'Offline')}</span>
                    </div>
                  ))
                ) : (
                  <div className="inline-empty">{t('No paired devices.')}</div>
                )}
                <button className="button button--outline" onClick={() => setSetup(true)}>
                  {t('Set up the extension')}
                  <ArrowUpRight size={15} />
                </button>
                <p className="account-footnote">
                  {t(
                    'The workspace works on phones and tablets. Agent execution requires a supported Chrome extension environment.',
                  )}
                </p>
              </section>
            </div>
          </>
        )}
        {error ? (
          <p className="form-message" role="alert">
            {t(error)}
          </p>
        ) : null}
      </main>
      {setup ? (
        <ConnectionDialog config={config} mode={mode} onClose={() => setSetup(false)} />
      ) : null}
    </div>
  );
}
