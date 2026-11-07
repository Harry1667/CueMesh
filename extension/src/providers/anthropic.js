// Anthropic Messages API 轉接層（官方 SDK、手動工具迴圈）
import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, classifyHttpError } from './types.js';

const NAME = 'anthropic';
const MAX_PAUSE_RESUMES = 5;

function toAnthropicMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'user') {
      return {
        role: 'user',
        content: m.content.map((c) =>
          c.type === 'image'
            ? { type: 'image', source: { type: 'base64', media_type: c.mediaType, data: c.data } }
            : { type: 'text', text: c.text },
        ),
      };
    }
    // 助理回合必須原樣送回（含 thinking 區塊）
    if (m.role === 'assistant') return { role: 'assistant', content: m.raw };
    return {
      role: 'user',
      content: m.results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        is_error: Boolean(r.isError),
        content: [
          { type: 'text', text: r.text || '（無輸出）' },
          ...(r.image
            ? [{ type: 'image', source: { type: 'base64', media_type: r.image.mediaType, data: r.image.data } }]
            : []),
        ],
      })),
    };
  });
}

// 較新的模型用支援動態過濾的搜尋工具，其餘用基本版
function searchTool(model) {
  const dynamic = /^claude-(opus|sonnet)-/.test(model);
  return { type: dynamic ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 5 };
}

function collectSources(content, sources) {
  for (const block of content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url) sources.set(r.url, { title: r.title || r.url, url: r.url });
    }
    if (block.type === 'text' && Array.isArray(block.citations)) {
      for (const c of block.citations) if (c.url) sources.set(c.url, { title: c.title || c.url, url: c.url });
    }
  }
}

export function createAnthropicProvider({ baseURL } = {}) {
  return {
    name: NAME,
    async turn({ apiKey, model, system, messages, tools = [], webSearch = false, maxTokens = 16000, effort, signal }) {
      const client = new Anthropic({ apiKey, baseURL, maxRetries: 1, dangerouslyAllowBrowser: true });
      const apiTools = [
        ...tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
        ...(webSearch ? [searchTool(model)] : []),
      ];
      const wire = toAnthropicMessages(messages);
      const usage = { input: 0, output: 0 };
      const sources = new Map();
      const content = [];

      try {
        for (let resume = 0; resume <= MAX_PAUSE_RESUMES; resume += 1) {
          const res = await client.messages.create(
            {
              model,
              max_tokens: maxTokens,
              system,
              messages: wire,
              ...(apiTools.length ? { tools: apiTools } : {}),
              ...(effort ? { output_config: { effort } } : {}),
            },
            { signal },
          );
          usage.input += res.usage?.input_tokens ?? 0;
          usage.output += res.usage?.output_tokens ?? 0;
          content.push(...res.content);
          collectSources(res.content, sources);

          if (res.stop_reason === 'refusal') {
            throw new ProviderError('refusal', `${NAME}：模型拒絕此請求`, { provider: NAME });
          }
          if (res.stop_reason === 'pause_turn') {
            // 內建工具達到伺服器迴圈上限：原樣送回助理回合即可續跑，不加額外訊息
            wire.push({ role: 'assistant', content: res.content });
            continue;
          }
          if (res.stop_reason === 'max_tokens') {
            throw new ProviderError('output_limit', `${NAME}：輸出超過 ${maxTokens} tokens 上限`, { provider: NAME });
          }
          break;
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw classifyHttpError(NAME, err);
      }

      const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const toolCalls = content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
      return { text, toolCalls, usage, sources: [...sources.values()], raw: content };
    },
  };
}
