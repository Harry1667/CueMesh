import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeminiProvider } from '../../src/providers/gemini.js';
import { ProviderError } from '../../src/providers/types.js';
import { geminiTextResponse, sendJson, startServer } from './helpers.js';

const API_KEY = 'gemini-test-key-must-not-leak';
const MODEL = 'gemini-test';
const USER_MESSAGE = [{ role: 'user', content: [{ type: 'text', text: '你好' }] }];

test('Gemini：純文字、用量與請求設定', async (t) => {
  const { baseURL, requests } = await startServer(t, ({ res }) => sendJson(res, 200, geminiTextResponse('您好')));
  const provider = createGeminiProvider({ baseURL: baseURL + '/' });

  const result = await provider.turn({
    apiKey: API_KEY,
    model: MODEL,
    system: '請簡短回答',
    messages: USER_MESSAGE,
    maxTokens: 123,
  });

  assert.equal(result.text, '您好');
  assert.deepEqual(result.usage, { input: 3, output: 2 });
  assert.deepEqual(result.raw, { role: 'model', parts: [{ text: '您好' }] });
  assert.equal(requests[0].method, 'POST');
  assert.match(requests[0].path, /^\/v1(?:beta)?\/models\/gemini-test:generateContent/);
  assert.deepEqual(requests[0].body.contents, [{ role: 'user', parts: [{ text: '你好' }] }]);
  assert.equal(requests[0].body.systemInstruction.parts[0].text, '請簡短回答');
  assert.equal(requests[0].body.generationConfig.maxOutputTokens, 123);
});

test('Gemini：圖片輸入轉為 inlineData', async (t) => {
  const { baseURL, requests } = await startServer(t, ({ res }) => sendJson(res, 200, geminiTextResponse('看到了')));
  const provider = createGeminiProvider({ baseURL: baseURL + '/' });

  await provider.turn({
    apiKey: API_KEY,
    model: MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '這是什麼？' },
        { type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=' },
      ],
    }],
  });

  assert.deepEqual(requests[0].body.contents[0].parts, [
    { text: '這是什麼？' },
    { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } },
  ]);
});

test('Gemini：工具接續時原樣帶回 thought signature 與工具截圖', async (t) => {
  const raw = {
    role: 'model',
    parts: [
      { thought: true, text: 'hidden', thoughtSignature: 'sig-thought' },
      { functionCall: { id: 'call-1', name: 'click', args: { ref: 'e42' } }, thoughtSignature: 'sig-call' },
    ],
  };
  const { baseURL, requests } = await startServer(t, ({ res, requests: allRequests }) => {
    if (allRequests.length === 1) {
      sendJson(res, 200, {
        candidates: [{ content: raw, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5 },
      });
      return;
    }
    sendJson(res, 200, geminiTextResponse('已完成'));
  });
  const provider = createGeminiProvider({ baseURL: baseURL + '/' });
  const tools = [{
    name: 'click',
    description: '點擊元素',
    parameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'], additionalProperties: false },
  }];

  const first = await provider.turn({ apiKey: API_KEY, model: MODEL, messages: USER_MESSAGE, tools });
  assert.deepEqual(first.toolCalls, [{ id: 'call-1', name: 'click', args: { ref: 'e42' } }]);

  const second = await provider.turn({
    apiKey: API_KEY,
    model: MODEL,
    messages: [
      ...USER_MESSAGE,
      { role: 'assistant', text: first.text, toolCalls: first.toolCalls, raw: first.raw },
      {
        role: 'tool',
        results: [{
          id: 'call-1',
          name: 'click',
          text: '已點擊',
          image: { mediaType: 'image/png', data: 'c2NyZWVu' },
        }],
      },
    ],
    tools,
  });

  assert.equal(second.text, '已完成');
  assert.equal(requests[0].body.tools[0].functionDeclarations[0].name, 'click');
  const followUp = requests[1].body.contents;
  assert.deepEqual(followUp[1], raw);
  assert.deepEqual(followUp[2], {
    role: 'user',
    parts: [{
      functionResponse: {
        id: 'call-1',
        name: 'click',
        response: { output: '已點擊' },
        parts: [{ inlineData: { mimeType: 'image/png', data: 'c2NyZWVu' } }],
      },
    }],
  });
});

test('Gemini：web search 來源，並在組合受限時保留搜尋捨棄函式', async (t) => {
  const { baseURL, requests } = await startServer(t, ({ res }) => {
    sendJson(res, 200, {
      candidates: [{
        content: { role: 'model', parts: [{ text: '找到資料' }] },
        finishReason: 'STOP',
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: 'https://example.test/a', title: '來源 A' } },
            { web: { uri: 'https://example.test/a', title: '重複來源' } },
          ],
        },
      }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
    });
  });
  const provider = createGeminiProvider({ baseURL: baseURL + '/' });

  const result = await provider.turn({
    apiKey: API_KEY,
    model: MODEL,
    messages: USER_MESSAGE,
    webSearch: true,
    tools: [{ name: 'click', description: '點擊元素', parameters: { type: 'object' } }],
  });

  assert.deepEqual(requests[0].body.tools, [{ googleSearch: {} }]);
  assert.deepEqual(result.sources, [{ title: '來源 A', url: 'https://example.test/a' }]);
});

test('Gemini：HTTP 錯誤統一分類且不洩漏 API key', async (t) => {
  for (const [status, kind] of [[401, 'auth'], [404, 'not_found'], [429, 'rate'], [500, 'server']]) {
    await t.test('HTTP ' + status, async (subtest) => {
      const { baseURL } = await startServer(subtest, ({ res }) => {
        sendJson(res, status, { error: { code: status, message: 'remote error contains ' + API_KEY } });
      });
      const provider = createGeminiProvider({ baseURL: baseURL + '/' });

      await assert.rejects(
        provider.turn({ apiKey: API_KEY, model: MODEL, messages: USER_MESSAGE }),
        (error) => {
          assert.ok(error instanceof ProviderError);
          assert.equal(error.provider, 'gemini');
          assert.equal(error.status, status);
          assert.equal(error.kind, kind);
          assert.ok(!error.message.includes(API_KEY));
          return true;
        },
      );
    });
  }
});

test('Gemini：取消直接傳遞 AbortError', async (t) => {
  const { baseURL, firstRequest } = await startServer(t, async () => {
    await new Promise(() => {});
  });
  const provider = createGeminiProvider({ baseURL: baseURL + '/' });
  const controller = new AbortController();
  const pending = provider.turn({ apiKey: API_KEY, model: MODEL, messages: USER_MESSAGE, signal: controller.signal });

  await firstRequest;
  controller.abort();
  await assert.rejects(
    pending,
    (error) => {
      assert.equal(error.name, 'AbortError');
      assert.ok(!(error instanceof ProviderError));
      return true;
    },
  );
});
