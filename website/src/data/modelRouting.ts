import type { Agent, Task } from '../lib/contracts';

// Display-only demo configuration from the user's November 7 routing table.
// Real runs always display the model reported by server/. This does not route requests.
export const demoModelRouting = {
  research: {
    label: 'Research',
    primary: 'gpt-6.1-sol',
    provider: 'openai',
    fallbacks: ['claude-sonnet-5-5'],
  },
  coding: {
    label: 'Coding',
    primary: 'claude-opus-5-5',
    provider: 'anthropic',
    fallbacks: ['claude-sonnet-5-5', 'gpt-6.1-sol'],
  },
  '3d': {
    label: '3D',
    primary: 'claude-opus-5-5',
    provider: 'anthropic',
    fallbacks: ['gpt-6.1-sol'],
  },
  vision: {
    label: 'Vision',
    primary: 'gpt-6.1-terra',
    provider: 'openai',
    fallbacks: ['claude-opus-5-5'],
  },
  planning: {
    label: 'Planning',
    primary: 'claude-opus-5-5',
    provider: 'anthropic',
    fallbacks: ['gpt-6.1-sol'],
  },
  review: {
    label: 'Review',
    primary: 'gpt-6.1-sol',
    provider: 'openai',
    fallbacks: ['claude-opus-5-5'],
  },
  browser: {
    label: 'Browser',
    primary: 'claude-opus-5-5',
    provider: 'anthropic',
    fallbacks: ['claude-sonnet-5-5', 'gpt-6.1-terra'],
  },
} satisfies Record<
  Agent,
  { label: string; primary: string; provider: Task['provider']; fallbacks: string[] }
>;

const modelNames: Record<string, string> = {
  'gpt-6.1-sol': 'GPT‑6.1 Sol',
  'gpt-6.1-terra': 'GPT‑6.1 Terra',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
};
export function modelLabel(id: string) {
  return modelNames[id] ?? id;
}
