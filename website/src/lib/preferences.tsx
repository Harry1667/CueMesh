import { createContext, useContext } from 'react';

export const languages = [
  { code: 'en', label: 'English' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
] as const;
export type Locale = (typeof languages)[number]['code'];
export type Theme = 'system' | 'light' | 'dark';
export type LanguagePreference = 'auto' | Locale;
type Preferences = { language: LanguagePreference; theme: Theme };
export const storageKey = 'cuemesh.preferences.v1';
const defaults: Preferences = { language: 'auto', theme: 'system' };

export function resolveLocale(preferences: readonly string[]): Locale {
  for (const value of preferences) {
    const code = value.toLowerCase();
    if (code.startsWith('zh')) return /hant|tw|hk|mo/.test(code) ? 'zh-TW' : 'zh-CN';
    const exact = languages.find((language) => language.code.toLowerCase() === code);
    if (exact) return exact.code;
    const base = languages.find((language) => language.code === code.split('-')[0]);
    if (base) return base.code;
  }
  return 'en';
}

export function loadPreferences(): Preferences {
  try {
    const saved: Partial<Preferences> = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return {
      language:
        saved.language === 'auto' || languages.some((language) => language.code === saved.language)
          ? saved.language!
          : defaults.language,
      theme:
        saved.theme && ['system', 'light', 'dark'].includes(saved.theme)
          ? saved.theme
          : defaults.theme,
    };
  } catch {
    return defaults;
  }
}

export type Translate = (text: string, values?: Record<string, string | number>) => string;
export const PreferencesContext = createContext<{
  locale: Locale;
  language: LanguagePreference;
  theme: Theme;
  t: Translate;
  setLanguage: (value: LanguagePreference) => void;
  setTheme: (value: Theme) => void;
} | null>(null);

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('PreferencesProvider is missing.');
  return context;
}
