import { createServer } from 'node:http';
import { once } from 'node:events';

export async function startServer(t, onRequest) {
  const requests = [];
  let resolveFirstRequest;
  const firstRequest = new Promise((resolve) => {
    resolveFirstRequest = resolve;
  });
  const server = createServer((req, res) => {
    Promise.resolve()
      .then(async () => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const request = {
          method: req.method,
          path: req.url,
          headers: req.headers,
          body: rawBody ? JSON.parse(rawBody) : undefined,
        };
        requests.push(request);
        resolveFirstRequest(request);
        await onRequest({ req, res, request, requests });
      })
      .catch((error) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: error.message } }));
        }
      });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseURL = 'http://127.0.0.1:' + address.port;

  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  return { baseURL, requests, firstRequest };
}

export function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function outputText(output) {
  return output
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('');
}

function completeUsage(usage = {}) {
  return {
    input_tokens: usage.input_tokens ?? 0,
    input_tokens_details: {
      cache_write_tokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
      cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0,
    },
    output_tokens: usage.output_tokens ?? 0,
    output_tokens_details: {
      reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    },
    total_tokens: usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
  };
}

// 維持 openai@7.53.0 Response 必填欄位，讓假伺服器回應對照 SDK 型別。
export function openAIResponse(output, usage = { input_tokens: 3, output_tokens: 2, total_tokens: 5 }) {
  return {
    id: 'resp-test',
    access_programs: null,
    output_text: outputText(output),
    object: 'response',
    created_at: 0,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    status: 'completed',
    model: 'gpt-test',
    parallel_tool_calls: true,
    temperature: 1,
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
    output,
    usage: completeUsage(usage),
  };
}

export function openAITextResponse(text) {
  return openAIResponse([
    {
      id: 'msg-test',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  ]);
}

