import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadTranslation } from '../locales/translations';
import {
  loadPreferences,
  resolveLocale,
  storageKey,
  PreferencesContext,
  type LanguagePreference,
  type Theme,
  type Translate,
} from './preferences';

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(loadPreferences);
  const [browserLanguages, setBrowserLanguages] = useState(() => [...navigator.languages]);
  const locale =
    preferences.language === 'auto' ? resolveLocale(browserLanguages) : preferences.language;
  const [catalogs, setCatalogs] = useState<Record<string, Record<string, string>>>({});
  useEffect(() => {
    let active = true;
    if (locale !== 'en')
      void loadTranslation(locale)
        .then((catalog) => {
          if (active) setCatalogs((current) => ({ ...current, [locale]: catalog }));
        })
        .catch(() => {
          /* English remains usable if a language asset is unavailable. */
        });
    return () => {
      active = false;
    };
  }, [locale]);
  useEffect(() => {
    const update = () => setBrowserLanguages([...navigator.languages]);
    window.addEventListener('languagechange', update);
    return () => window.removeEventListener('languagechange', update);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      /* Private browsing can disable persistence. */
    }
  }, [preferences]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
  useEffect(() => {
    const systemTheme = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      document.documentElement.dataset.theme =
        preferences.theme === 'system'
          ? systemTheme.matches
            ? 'dark'
            : 'light'
          : preferences.theme;
    };
    update();
    systemTheme.addEventListener('change', update);
    return () => systemTheme.removeEventListener('change', update);
  }, [preferences.theme]);
  const value = useMemo(
    () => ({
      locale,
      ...preferences,
      setLanguage: (language: LanguagePreference) =>
        setPreferences((current) => ({ ...current, language })),
      setTheme: (theme: Theme) => setPreferences((current) => ({ ...current, theme })),
      t: ((text, values) => {
        let translated = catalogs[locale]?.[text] ?? text;
        for (const [key, value] of Object.entries(values ?? {}))
          translated = translated.replaceAll(`{${key}}`, String(value));
        return translated;
      }) as Translate,
    }),
    [locale, preferences, catalogs],
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
