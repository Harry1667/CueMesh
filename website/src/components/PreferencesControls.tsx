import { Languages, Monitor, Moon, Sun, X } from 'lucide-react';
import { useRef } from 'react';
import { languages, usePreferences, type LanguagePreference, type Theme } from '../lib/preferences';

export function PreferencesControls() {
  const { t, language, theme, setLanguage, setTheme } = usePreferences();
  const details = useRef<HTMLDetailsElement>(null);
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <details
      className="preferences"
      ref={details}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && details.current) {
          details.current.open = false;
          details.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary aria-label={t('Language and appearance')}>
        <Languages size={17} />
        <ThemeIcon size={15} />
      </summary>
      <div className="preferences-panel">
        <div className="preferences-title">
          <strong>{t('Make it yours')}</strong>
          <button
            type="button"
            className="icon-button"
            aria-label={t('Close preferences')}
            onClick={() => {
              if (details.current) {
                details.current.open = false;
                details.current.querySelector('summary')?.focus();
              }
            }}
          >
            <X size={15} />
          </button>
        </div>
        <label>
          {t('Language')}
          <select
            aria-label={t('Language')}
            value={language}
            onChange={(event) => setLanguage(event.target.value as LanguagePreference)}
          >
            <option value="auto">{t('Follow browser')}</option>
            {languages.map((item) => (
              <option value={item.code} key={item.code} lang={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Appearance')}
          <select
            aria-label={t('Appearance')}
            value={theme}
            onChange={(event) => setTheme(event.target.value as Theme)}
          >
            <option value="system">{t('Follow device')}</option>
            <option value="light">{t('Light')}</option>
            <option value="dark">{t('Dark')}</option>
          </select>
        </label>
        <p>{t('Your choice is remembered on this browser.')}</p>
      </div>
    </details>
  );
}
