import { createAnthropicProvider } from './anthropic.js';
import { createOpenAIProvider } from './openai.js';

export function createProviders({ baseURLs } = {}) {
  return {
    anthropic: createAnthropicProvider({ baseURL: baseURLs?.anthropic }),
    openai: createOpenAIProvider({ baseURL: baseURLs?.openai }),
  };
}
