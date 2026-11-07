import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIProvider } from '../../src/providers/openai.js';
import { ProviderError } from '../../src/providers/types.js';
import { openAIResponse, openAITextResponse, sendJson, startServer } from './helpers.js';

const API_KEY = 'openai-test-key-must-not-leak';
const MODEL = 'gpt-test';
const USER_MESSAGE = [{ role: 'user', content: [{ type: 'text', text: '你好' }] }];

test('OpenAI：純文字、用量與請求設定', async (t) => {
  const expected = openAITextResponse('您好');
  const { baseURL, requests } = await startServer(t, ({ res }) => sendJson(res, 200, expected));
  const provider = createOpenAIProvider({ baseURL: baseURL + '/v1' });

  const result = await provider.turn({
    apiKey: API_KEY,
    model: MODEL,
    system: '請簡短回答',
    messages: USER_MESSAGE,
    maxTokens: 123,
    effort: 'high',
  });

  assert.equal(result.text, '您好');
  assert.deepEqual(result.usage, { input: 3, output: 2 });
  assert.deepEqual(result.raw, expected.output);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].path, '/v1/responses');
  assert.deepEqual(requests[0].body.input, [
    { role: 'user', content: [{ type: 'input_text', text: '你好' }] },
  ]);
  assert.equal(requests[0].body.instructions, '請簡短回答');
  assert.equal(requests[0].body.max_output_tokens, 123);
  assert.deepEqual(requests[0].body.reasoning, { effort: 'high' });
});

test('OpenAI：圖片輸入轉為 data URL', async (t) => {
  const { baseURL, requests } = await startServer(t, ({ res }) => sendJson(res, 200, openAITextResponse('看到了')));
  const provider = createOpenAIProvider({ baseURL: baseURL + '/v1' });

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

  assert.deepEqual(requests[0].body.input[0].content, [
    { type: 'input_text', text: '這是什麼？' },
    { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=', detail: 'auto' },
  ]);
});

test('OpenAI：工具接續時保留 raw reasoning，工具結果後用 user 圖片訊息', async (t) => {
  const raw = [
    { id: 'rs-1', type: 'reasoning', summary: [], encrypted_content: 'opaque-reasoning', created_by: 'server' },
    {
      id: 'fc-item-1',
      type: 'function_call',
      call_id: 'call-1',
      name: 'click',
      arguments: '{"ref":"e42"}',
      status: 'completed',
    },
  ];
  const { baseURL, requests } = await startServer(t, ({ res, requests: allRequests }) => {
    if (allRequests.length === 1) {
      sendJson(res, 200, openAIResponse(raw, { input_tokens: 11, output_tokens: 5, total_tokens: 16 }));
      return;
    }
    sendJson(res, 200, openAITextResponse('已完成'));
  });
  const provider = createOpenAIProvider({ baseURL: baseURL + '/v1' });
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
          text: '{"ok":true}',
          image: { mediaType: 'image/png', data: 'c2NyZWVu' },
        }],
      },
    ],
    tools,
  });

  assert.equal(second.text, '已完成');
  assert.deepEqual(requests[0].body.tools, [{
    type: 'function',
    name: 'click',
    description: '點擊元素',
    parameters: tools[0].parameters,
    strict: true,
  }]);
  const followUp = requests[1].body.input;
  assert.deepEqual(followUp.slice(1, 3), raw);
  assert.deepEqual(followUp[3], {
    type: 'function_call_output',
    call_id: 'call-1',
    output: '{"ok":true}',
  });
  assert.deepEqual(followUp[4], {
    role: 'user',
    content: [
      { type: 'input_text', text: '工具執行後的畫面：' },
      { type: 'input_image', image_url: 'data:image/png;base64,c2NyZWVu', detail: 'auto' },
    ],
  });
});

test('OpenAI：web search 工具與引用來源', async (t) => {
  const response = openAIResponse([
    {
      id: 'msg-search',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{
        type: 'output_text',
        text: '找到資料',
        annotations: [
          { type: 'url_citation', start_index: 0, end_index: 2, url: 'https://example.test/a', title: '來源 A' },
          { type: 'url_citation', start_index: 0, end_index: 2, url: 'https://example.test/a', title: '重複來源' },
        ],
      }],
    },
  ]);
  const { baseURL, requests } = await startServer(t, ({ res }) => sendJson(res, 200, response));
  const provider = createOpenAIProvider({ baseURL: baseURL + '/v1' });

  const result = await provider.turn({ apiKey: API_KEY, model: MODEL, messages: USER_MESSAGE, webSearch: true });

  assert.deepEqual(requests[0].body.tools, [{ type: 'web_search' }]);
  assert.deepEqual(result.sources, [{ title: '來源 A', url: 'https://example.test/a' }]);
});

test('OpenAI：HTTP 錯誤統一分類且不洩漏 API key', async (t) => {
  for (const [status, kind] of [[401, 'auth'], [404, 'not_found'], [429, 'rate'], [500, 'server']]) {
    await t.test('HTTP ' + status, async (subtest) => {
      const { baseURL } = await startServer(subtest, ({ res }) => {
        sendJson(res, status, { error: { message: 'remote error contains ' + API_KEY } });
      });
      const provider = createOpenAIProvider({ baseURL: baseURL + '/v1' });

      await assert.rejects(
        provider.turn({ apiKey: API_KEY, model: MODEL, messages: USER_MESSAGE }),
        (error) => {
          assert.ok(error instanceof ProviderError);
          assert.equal(error.provider, 'openai');
          assert.equal(error.status, status);
          assert.equal(error.kind, kind);
          assert.ok(!error.message.includes(API_KEY));
          return true;
        },
      );
    });
  }
});

test('OpenAI：取消直接傳遞 Abort 錯誤', async (t) => {
  const { baseURL, firstRequest } = await startServer(t, async () => {
    await new Promise(() => {});
  });
  const provider = createOpenAIProvider({ baseURL: baseURL + '/v1' });
  const controller = new AbortController();
  const pending = provider.turn({ apiKey: API_KEY, model: MODEL, messages: USER_MESSAGE, signal: controller.signal });

  await firstRequest;
  controller.abort();
  await assert.rejects(
    pending,
    (error) => {
      assert.ok(error.name === 'AbortError' || error.constructor?.name === 'APIUserAbortError');
      assert.ok(!(error instanceof ProviderError));
      return true;
    },
  );
});
