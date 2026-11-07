// Gemini generateContent API 轉接層（官方 SDK、由核心手動執行工具）
import { GoogleGenAI } from '@google/genai';
import { ProviderError, classifyHttpError } from './types.js';

const NAME = 'gemini';
const REFUSAL_FINISH_REASONS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

function toGeminiContents(messages) {
  return messages.map((message) => {
    if (message.role === 'user') {
      return {
        role: 'user',
        parts: message.content.map((part) =>
          part.type === 'image'
            ? { inlineData: { mimeType: part.mediaType, data: part.data } }
            : { text: part.text },
        ),
      };
    }

    if (message.role === 'assistant') {
      // candidate.content 內含 thoughtSignature，必須整包重送，不能重組 parts。
      return message.raw;
    }

    return {
      role: 'user',
      parts: message.results.map((result) => ({
        functionResponse: {
          // Gemini 不一定會給 functionCall id；沒有就不送，靠 name 與順序對應，不能送空字串
          ...(result.id ? { id: result.id } : {}),
          name: result.name,
          response: result.isError ? { error: result.text || '（無輸出）' } : { output: result.text || '（無輸出）' },
          ...(result.image
            ? { parts: [{ inlineData: { mimeType: result.image.mediaType, data: result.image.data } }] }
            : {}),
        },
      })),
    };
  });
}

function collectSources(candidates) {
  const sources = new Map();
  for (const candidate of candidates ?? []) {
    for (const chunk of candidate.groundingMetadata?.groundingChunks ?? []) {
      const web = chunk.web;
      if (web?.uri && !sources.has(web.uri)) {
        sources.set(web.uri, { title: web.title || web.uri, url: web.uri });
      }
    }
  }
  return [...sources.values()];
}

function outputText(candidate) {
  return (candidate?.content?.parts ?? [])
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('');
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.name === 'APIUserAbortError';
}

export function createGeminiProvider({ baseURL } = {}) {
  return {
    name: NAME,
    async turn({ apiKey, model, system, messages, tools = [], webSearch = false, maxTokens = 16000, signal }) {
      const client = new GoogleGenAI({
        apiKey,
        ...(baseURL ? { httpOptions: { baseUrl: baseURL } } : {}),
      });

      // Gemini 的搜尋 + 自訂函式組合有模型與 validated 模式限制；依共同介面優先保留搜尋。
      const apiTools = webSearch
        ? [{ googleSearch: {} }]
        : tools.length
          ? [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }]
          : undefined;

      try {
        const response = await client.models.generateContent({
          model,
          contents: toGeminiContents(messages),
          config: {
            ...(system ? { systemInstruction: system } : {}),
            maxOutputTokens: maxTokens,
            ...(apiTools ? { tools: apiTools } : {}),
            ...(signal ? { abortSignal: signal } : {}),
          },
        });
        const candidate = response.candidates?.[0];

        if (candidate?.finishReason === 'MAX_TOKENS') {
          throw new ProviderError('output_limit', NAME + '：輸出超過 ' + maxTokens + ' tokens 上限', { provider: NAME });
        }
        if (REFUSAL_FINISH_REASONS.has(candidate?.finishReason) || response.promptFeedback?.blockReason) {
          throw new ProviderError('refusal', NAME + '：模型拒絕此請求', { provider: NAME });
        }

        return {
          // 不使用 SDK 的 response.text getter，避免 functionCall 與文字共存時寫入 console warning。
          text: outputText(candidate),
          toolCalls: (response.functionCalls ?? []).map((call) => ({
            id: call.id ?? '',
            name: call.name ?? '',
            args: call.args ?? {},
          })),
          usage: {
            input: response.usageMetadata?.promptTokenCount ?? 0,
            // 思考 token 也按輸出計費，漏算會讓預算上限失準
            output: (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0),
          },
          sources: collectSources(response.candidates),
          // 只保存模型 Content，下一輪可不變地帶回 thoughtSignature 與 functionCall。
          raw: candidate?.content,
        };
      } catch (error) {
        if (error instanceof ProviderError || isAbortError(error)) throw error;
        // Google 對無效 API key 回 HTTP 400，不是 401，要另外辨識才能給使用者正確提示
        if (/API_KEY_INVALID|API key not valid/i.test(error?.message ?? '')) {
          throw new ProviderError('auth', NAME + '：API key 無效', { provider: NAME, status: error?.status });
        }
        // 部分 SDK 錯誤使用 statusCode，統一交由共同 HTTP 分類器處理。
        throw classifyHttpError(NAME, { status: error?.status ?? error?.statusCode });
      }
    },
  };
}
