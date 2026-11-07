import { ArrowUpRight } from 'lucide-react';
import { Brand } from './Brand';
import { Link, usePath } from './Link';
import { PreferencesControls } from './PreferencesControls';
import { usePreferences } from '../lib/preferences';
export type DataMode = 'demo' | 'live';

export function AppHeader({
  mode,
  onModeChange,
}: {
  mode: DataMode;
  onModeChange: (mode: DataMode) => void;
}) {
  const { t } = usePreferences();
  const path = usePath();
  return (
    <header className="workspace-header app-header">
      <Brand />
      <nav className="app-nav" aria-label={t('Workspace navigation')}>
        <Link href="/workspace" aria-current={path === '/workspace' ? 'page' : undefined}>
          {t('Runs')}
        </Link>
        <Link href="/team" aria-current={path === '/team' ? 'page' : undefined}>
          {t('Team')}
        </Link>
        <Link href="/account" aria-current={path === '/account' ? 'page' : undefined}>
          {t('Account')}
        </Link>
      </nav>
      <div className="workspace-header-actions">
        <span className={`connection-state connection-state--${mode}`}>
          <span />
          {t(mode === 'demo' ? 'Demo workspace' : 'Live workspace')}
        </span>
        <button
          className="button button--small button--outline"
          onClick={() => onModeChange(mode === 'demo' ? 'live' : 'demo')}
        >
          {t(mode === 'demo' ? 'Connect live' : 'Explore demo')}
          <ArrowUpRight size={13} />
        </button>
        <PreferencesControls />
      </div>
    </header>
  );
}
