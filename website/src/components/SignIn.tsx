import { useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePreferences } from '../lib/preferences';

export function SignIn({ onSignedIn }: { onSignedIn?: () => void }) {
  const { t } = usePreferences();
  const auth = useAuth();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setPending(true);
    setError('');
    try {
      if (creating)
        await auth.register(
          String(fields.get('email')),
          String(fields.get('password')),
          String(fields.get('displayName')),
        );
      else await auth.login(String(fields.get('email')), String(fields.get('password')));
      form.reset();
      onSignedIn?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="account-sign-in">
      <span className="eyebrow">{t('ONE ACCOUNT. SHARED DIRECTION.')}</span>
      <h1>{t(creating ? 'Make room for your next idea.' : 'Your work belongs together.')}</h1>
      <p>{t('Use the same CueMesh account on the website and in your extension.')}</p>
      <div className="auth-mode">
        <button
          aria-pressed={!creating}
          onClick={() => {
            setCreating(false);
            setError('');
          }}
        >
          {t('Sign in')}
        </button>
        <button
          aria-pressed={creating}
          onClick={() => {
            setCreating(true);
            setError('');
          }}
        >
          {t('Create account')}
        </button>
      </div>
      <form className="account-form" onSubmit={(event) => void submit(event)}>
        {creating ? (
          <label>
            {t('Display name')}
            <input name="displayName" autoComplete="name" required maxLength={100} />
          </label>
        ) : null}
        <label>
          {t('Email')}
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          {t('Password')}
          <input
            key={creating ? 'new' : 'existing'}
            name="password"
            type="password"
            minLength={creating ? 10 : 1}
            maxLength={1024}
            autoComplete={creating ? 'new-password' : 'current-password'}
            required
          />
          {creating ? <small>{t('Use at least 10 characters.')}</small> : null}
        </label>
        <button className="button button--dark" disabled={pending}>
          {t(pending ? 'Connecting…' : creating ? 'Create account' : 'Sign in')}
          <ArrowRight size={16} />
        </button>
        {error ? (
          <p className="form-message" role="alert">
            {t(error)}
          </p>
        ) : null}
      </form>
      <p className="account-footnote">
        <ShieldCheck size={15} />
        {t('Your sign-in session stays in memory. Reloading this page signs you out.')}
      </p>
    </section>
  );
}
