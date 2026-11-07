// 三家供應商共用的錯誤型別。
//
// 統一的 turn() 介面：
//   turn({ apiKey, model, system, messages, tools, webSearch, maxTokens, effort, signal })
//   → { text, toolCalls: [{ id, name, args }], usage: { input, output }, sources: [{ title, url }], raw }
//
// 中立訊息格式：
//   { role: 'user', content: [{ type: 'text', text } | { type: 'image', mediaType, data }] }
//   { role: 'assistant', text, toolCalls, raw }   raw 是供應商原始內容，同一供應商續接時必須原樣送回
//   { role: 'tool', results: [{ id, name, text, image?, isError? }] }

export const PROVIDER_ERROR_KINDS = ['auth', 'rate', 'server', 'network', 'bad_request', 'not_found', 'refusal', 'output_limit'];

export class ProviderError extends Error {
  constructor(kind, message, { provider, status } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.provider = provider;
    this.status = status;
  }
}

const MESSAGES = {
  auth: 'API key 無效或沒有這個模型的權限',
  rate: '已達速率或額度上限',
  server: '供應商伺服器暫時錯誤',
  network: '無法連線到供應商',
  bad_request: '請求被供應商拒絕',
  not_found: '模型不存在或目前不可用',
};

// 把 HTTP 狀態轉成統一錯誤。訊息一律用固定文字，避免供應商回應把部分金鑰帶進日誌與主控台。
export function classifyHttpError(provider, err) {
  const status = err?.status;
  if (err?.name === 'AbortError' || err?.name === 'APIUserAbortError') return err;
  let kind;
  if (status === 401 || status === 403) kind = 'auth';
  else if (status === 404) kind = 'not_found';
  else if (status === 408 || status === 409 || status === 429) kind = 'rate';
  else if (typeof status === 'number' && status >= 500) kind = 'server';
  else if (typeof status === 'number') kind = 'bad_request';
  else kind = 'network';
  return new ProviderError(kind, `${provider}：${MESSAGES[kind]}${status ? `（HTTP ${status}）` : ''}`, { provider, status });
}
