import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeminiProvider } from '../../src/providers/gemini.js';
import { ProviderError } from '../../src/providers/types.js';
import { geminiTextResponse, sendJson, startServer } from './helpers.js';

const API_KEY = 'gemini-edge-key-must-not-leak';
const USER = [{ role: 'user', content: [{ type: 'text', text: '你好' }] }];

test('Gemini：functionCall 沒有 id 時，工具結果不送空字串 id', async (t) => {
  const raw = { role: 'model', parts: [{ functionCall: { name: 'click', args: { ref: 'e1' } } }] };
  const { baseURL, requests } = await startServer(t, ({ res, requests: all }) => {
    if (all.length === 1) {
      sendJson(res, 200, { candidates: [{ content: raw, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
    } else {
      sendJson(res, 200, geminiTextResponse('完成'));
    }
  });
  const provider = createGeminiProvider({ baseURL: baseURL + '/' });
  const first = await provider.turn({ apiKey: API_KEY, model: 'm', messages: USER, tools: [{ name: 'click', description: 'd', parameters: { type: 'object', properties: {} } }] });
  assert.equal(first.toolCalls[0].id, '');

  await provider.turn({
    apiKey: API_KEY, model: 'm',
    messages: [...USER, { role: 'assistant', raw: first.raw }, { role: 'tool', results: [{ id: first.toolCalls[0].id, name: 'click', text: 'ok' }] }],
  });
  const response = requests[1].body.contents.at(-1).parts[0].functionResponse;
  assert.equal(response.name, 'click');
  assert.equal('id' in response, false);
});

test('Gemini：思考 token 計入輸出用量', async (t) => {
  const { baseURL } = await startServer(t, ({ res }) =>
    sendJson(res, 200, {
      candidates: [{ content: { role: 'model', parts: [{ text: '好' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 100 },
    }),
  );
  const result = await createGeminiProvider({ baseURL: baseURL + '/' }).turn({ apiKey: API_KEY, model: 'm', messages: USER });
  assert.deepEqual(result.usage, { input: 10, output: 105 });
});

test('Gemini：無效 API key（HTTP 400）判定為 auth，且訊息不含金鑰', async (t) => {
  const { baseURL } = await startServer(t, ({ res }) =>
    sendJson(res, 400, {
      error: {
        code: 400, status: 'INVALID_ARGUMENT', message: `API key not valid: ${API_KEY}`,
        details: [{ reason: 'API_KEY_INVALID' }],
      },
    }),
  );
  await assert.rejects(
    createGeminiProvider({ baseURL: baseURL + '/' }).turn({ apiKey: API_KEY, model: 'm', messages: USER }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.kind, 'auth');
      assert.ok(!err.message.includes(API_KEY));
      return true;
    },
  );
});
