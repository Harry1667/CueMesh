import { usePreferences } from '../lib/preferences';
import { Link } from './Link';

export function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = usePreferences();

  return (
    <Link
      href="/"
      className={`brand ${compact ? 'brand--compact' : ''}`}
      aria-label={t('CueMesh home')}
    >
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>CueMesh</span>
    </Link>
  );
}
