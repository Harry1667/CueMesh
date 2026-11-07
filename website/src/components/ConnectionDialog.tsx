import { useEffect, useRef } from 'react';
import { ArrowUpRight, Chrome, X } from 'lucide-react';
import type { RuntimeConfig } from '../lib/contracts';
import { usePreferences } from '../lib/preferences';
import { Link } from './Link';

export function ConnectionDialog({
  onClose,
  config,
  mode,
}: {
  onClose: () => void;
  config: RuntimeConfig;
  mode: 'demo' | 'live';
}) {
  const { t } = usePreferences();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      returnFocus?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="connection-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="connection-title"
    >
      <div className="dialog-top">
        <span className="eyebrow">{t('YOUR BROWSER, CONNECTED')}</span>
        <button className="icon-button" aria-label={t('Close extension setup')} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="dialog-icon">
        <Chrome size={25} />
      </div>
      <h2 id="connection-title">{t('Start there. Follow it here.')}</h2>
      <p>
        {t(
          'The extension runs your tasks. Your CueMesh account brings the progress and results here.',
        )}
      </p>
      <ol className="setup-steps">
        <li>
          <span>01</span>
          <div>
            <strong>{t('Get the extension')}</strong>
            <p>{t('Follow the project’s current installation instructions.')}</p>
            <a href={config.extensionInstallUrl} target="_blank" rel="noreferrer">
              {t('Open project instructions')}
              <ArrowUpRight size={14} />
            </a>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>{t('Use the same account')}</strong>
            <p>{t('Sign in to CueMesh in your extension and on this website.')}</p>
            <Link href="/account" onClick={onClose}>
              {t('Open account')}
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>{t('Give your first cue')}</strong>
            <p>{t('Select context in Chrome and start a task. Synced runs appear here.')}</p>
          </div>
        </li>
      </ol>
      <div className="notice">
        {t(
          mode === 'demo'
            ? 'Demo mode shows sample work. Your real projects appear after signing in to the live service.'
            : 'Browser actions are approved on the device executing them. Your provider keys stay out of this website.',
        )}
      </div>
    </dialog>
  );
}
