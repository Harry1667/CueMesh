// UI dictionaries are local assets. Project content remains in its source language.
export const translationLoaders = {
  'zh-TW': () => import('./zh-TW.json'),
  'zh-CN': () => import('./zh-CN.json'),
  ja: () => import('./ja.json'),
  ko: () => import('./ko.json'),
  es: () => import('./es.json'),
  fr: () => import('./fr.json'),
  de: () => import('./de.json'),
  pt: () => import('./pt.json'),
  ar: () => import('./ar.json'),
  hi: () => import('./hi.json'),
};
export async function loadTranslation(locale: string): Promise<Record<string, string>> {
  const loader = translationLoaders[locale as keyof typeof translationLoaders];
  return loader ? (await loader()).default : {};
}
