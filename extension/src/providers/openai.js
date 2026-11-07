// OpenAI Responses API 轉接層（官方 SDK、由核心手動執行工具）
import OpenAI, { APIUserAbortError } from 'openai';
import { ProviderError, classifyHttpError } from './types.js';

const NAME = 'openai';

function imageUrl(mediaType, data) {
  return 'data:' + mediaType + ';base64,' + data;
}

function toOpenAIInput(messages) {
  const input = [];

  for (const message of messages) {
    if (message.role === 'user') {
      input.push({
        role: 'user',
        content: message.content.map((part) =>
          part.type === 'image'
            ? { type: 'input_image', image_url: imageUrl(part.mediaType, part.data), detail: 'auto' }
            : { type: 'input_text', text: part.text },
        ),
      });
      continue;
    }

    if (message.role === 'assistant') {
      // raw 是上一回合的完整 Responses output，reasoning 與 function_call 必須原樣重送。
      if (Array.isArray(message.raw)) input.push(...message.raw);
      continue;
    }

    // 每個 function call 都必須先有 function_call_output，才可接著送截圖。
    for (const result of message.results) {
      input.push({
        type: 'function_call_output',
        call_id: result.id,
        output: result.isError
          ? JSON.stringify({ error: result.text || '（無輸出）' })
          : result.text || '（無輸出）',
      });
    }
    // function_call_output 帶圖片的官方文件尚未確認，故用普通 user 圖片訊息。
    for (const result of message.results) {
      if (!result.image) continue;
      input.push({
        role: 'user',
        content: [
          { type: 'input_text', text: '工具執行後的畫面：' },
          { type: 'input_image', image_url: imageUrl(result.image.mediaType, result.image.data), detail: 'auto' },
        ],
      });
    }
  }

  return input;
}

function collectSources(output) {
  const sources = new Map();
  for (const item of output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type !== 'output_text') continue;
      for (const annotation of part.annotations ?? []) {
        if (annotation.type === 'url_citation' && annotation.url) {
          if (!sources.has(annotation.url)) {
            sources.set(annotation.url, { title: annotation.title || annotation.url, url: annotation.url });
          }
        }
      }
    }
  }
  return [...sources.values()];
}

function outputText(output) {
  return (output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('');
}

function hasRefusal(output) {
  return (output ?? []).some(
    (item) => item.type === 'message' && (item.content ?? []).some((part) => part.type === 'refusal'),
  );
}

function parseArguments(argumentsText) {
  try {
    const value = JSON.parse(argumentsText || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    throw new ProviderError('bad_request', NAME + '：模型回傳了無效的工具參數', { provider: NAME });
  }
}

function isAbortError(error, signal) {
  return error?.name === 'AbortError' || error?.name === 'APIUserAbortError' || error instanceof APIUserAbortError || signal?.aborted;
}

export function createOpenAIProvider({ baseURL } = {}) {
  return {
    name: NAME,
    async turn({ apiKey, model, system, messages, tools = [], webSearch = false, maxTokens = 16000, effort, signal }) {
      const client = new OpenAI({ apiKey, baseURL, maxRetries: 0, dangerouslyAllowBrowser: true });
      const apiTools = [
        ...tools.map((tool) => ({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: true,
        })),
        ...(webSearch ? [{ type: 'web_search' }] : []),
      ];

      try {
        const response = await client.responses.create(
          {
            model,
            ...(system ? { instructions: system } : {}),
            input: toOpenAIInput(messages),
            max_output_tokens: maxTokens,
            ...(apiTools.length ? { tools: apiTools } : {}),
            ...(effort ? { reasoning: { effort } } : {}),
          },
          { signal },
        );

        if (response.incomplete_details?.reason === 'max_output_tokens') {
          throw new ProviderError('output_limit', NAME + '：輸出超過 ' + maxTokens + ' tokens 上限', { provider: NAME });
        }
        if (hasRefusal(response.output)) {
          throw new ProviderError('refusal', NAME + '：模型拒絕此請求', { provider: NAME });
        }

        const output = response.output ?? [];
        return {
          text: response.output_text ?? outputText(output),
          toolCalls: output
            .filter((item) => item.type === 'function_call')
            .map((item) => ({ id: item.call_id, name: item.name, args: parseArguments(item.arguments) })),
          usage: {
            input: response.usage?.input_tokens ?? 0,
            output: response.usage?.output_tokens ?? 0,
          },
          sources: collectSources(output),
          // 保留完整 output；下一輪直接重放推理項目。
          raw: output,
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (isAbortError(error, signal)) {
          // SDK 的 APIUserAbortError 目前 name 是 Error；保持原物件但修正為介面保證的 AbortError。
          if (error?.name !== 'AbortError') error.name = 'AbortError';
          throw error;
        }
        throw classifyHttpError(NAME, error);
      }
    },
  };
}
