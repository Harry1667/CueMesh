import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import { translationLoaders } from '../locales/translations';
import { demoModelRouting, modelLabel } from '../data/modelRouting';
import { getDemoDetail } from '../data/demo';

describe('language catalogs', () => {
  for (const [locale, load] of Object.entries(translationLoaders)) {
    it(`${locale} covers the English catalog and preserves interpolation`, async () => {
      const catalog: Record<string, string> = (await load()).default;
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim(), key).not.toBe('');
        expect([...value.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort(), key).toEqual(
          [...key.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort(),
        );
      }
    });
  }
});
describe('requested demo model configuration', () => {
  it('uses the supplied roles, primaries and ordered fallbacks', () => {
    expect(Object.keys(demoModelRouting)).toHaveLength(7);
    expect(demoModelRouting.research.primary).toBe('gpt-6.1-sol');
    expect(demoModelRouting['3d'].primary).toBe('claude-opus-5-5');
    expect(demoModelRouting.vision.primary).toBe('gpt-6.1-terra');
    expect(demoModelRouting.browser.fallbacks).toEqual(['claude-sonnet-5-5', 'gpt-6.1-terra']);
    const detail = getDemoDetail('demo-run-1');
    for (const task of detail.tasks) expect(task.model).toBe(demoModelRouting[task.agent].primary);
    expect(detail.tasks.find((task) => task.agent === 'research')?.provider).toBe('openai');
  });
  it('keeps unrecognized server model IDs unchanged', () => {
    expect(modelLabel('server-selected-model')).toBe('server-selected-model');
  });
});
