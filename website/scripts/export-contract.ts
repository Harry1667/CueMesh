import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as contract from '../src/lib/contracts';
import { demoProjects, demoRuns, getDemoDetail } from '../src/data/demo';
import {
  demoDevices,
  demoDispatchDetail,
  demoMembers,
  demoSharedProject,
} from '../src/data/teamDemo';

const schemas = Object.fromEntries(
  Object.entries(contract)
    .filter(([name, value]) => name.endsWith('Schema') && value instanceof z.ZodType)
    .map(([name, value]) => {
      const json = z.toJSONSchema(value as z.ZodType);
      delete json.$schema;
      return [name.replace(/Schema$/, ''), json];
    }),
);
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({ 'application/json': { schema: ref(name) } });
const parameter = (name: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', minLength: 1 },
});
function operation(
  id: string,
  response: string | null,
  options: { body?: string; public?: boolean; status?: string; parameters?: unknown[] } = {},
) {
  return {
    operationId: id,
    security: options.public ? [] : [{ bearerAuth: [] }],
    ...(options.parameters ? { parameters: options.parameters } : {}),
    ...(options.body ? { requestBody: { required: true, content: json(options.body) } } : {}),
    responses: {
      [options.status ?? '200']: {
        description: 'Successful server response',
        ...(response ? { content: json(response) } : {}),
      },
      '400': { description: 'Invalid input', content: json('ApiError') },
      '401': { description: 'Not signed in', content: json('ApiError') },
      '403': { description: 'Permission denied', content: json('ApiError') },
      '404': { description: 'Missing or inaccessible record', content: json('ApiError') },
      '409': { description: 'Conflict', content: json('ApiError') },
      '413': { description: 'Payload too large', content: json('ApiError') },
      '429': { description: 'Rate limit exceeded', content: json('ApiError') },
    },
  };
}
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'CueMesh cloud v1 — frontend-consumed endpoints',
    version: '1.0.0',
    description:
      'Derived from docs/cloud-api.md and docs/integration-contract.md at c03029375b14160bd9b39b65cd97e772d7416124. Server owns all accounts. This is the website subset, not a replacement for the authoritative server contract. RunDetail is an internal view model, not a server response. No OAuth, cookie-session, Supabase, or pairing-token endpoints are invented here.',
  },
  servers: [{ url: '/api' }],
  paths: {
    '/auth/register': {
      post: operation('register', 'AuthResponse', {
        body: 'RegisterRequest',
        public: true,
        status: '201',
      }),
    },
    '/auth/login': {
      post: operation('login', 'AuthResponse', { body: 'LoginRequest', public: true }),
    },
    '/auth/logout': { post: operation('logout', null, { status: '204' }) },
    '/me': { get: operation('me', 'MeResponse') },
    '/projects': { get: operation('projects', 'ProjectsResponse') },
    '/projects/{projectId}': {
      put: operation('saveProject', 'ProjectResponse', {
        body: 'ProjectWrite',
        parameters: [parameter('projectId')],
      }),
    },
    '/projects/{projectId}/runs': {
      get: operation('projectRuns', 'RunsResponse', { parameters: [parameter('projectId')] }),
    },
    '/runs/{runId}': {
      get: operation('run', 'CloudRunResponse', { parameters: [parameter('runId')] }),
    },
    '/devices': { get: operation('devices', 'DevicesResponse') },
    '/projects/{projectId}/members': {
      get: operation('members', 'MembersResponse', { parameters: [parameter('projectId')] }),
    },
    '/projects/{projectId}/invites': {
      post: operation('createInvite', 'InviteResponse', {
        parameters: [parameter('projectId')],
        status: '201',
      }),
    },
    '/invites/accept': {
      post: operation('acceptInvite', 'ProjectResponse', { body: 'InviteAccept' }),
    },
    '/dispatches': {
      get: operation('dispatches', 'DispatchesResponse', {
        parameters: [
          {
            name: 'role',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: ['incoming', 'outgoing'] },
          },
        ],
      }),
    },
    '/dispatches/{dispatchId}': {
      get: operation('dispatchDetail', 'DispatchDetail', { parameters: [parameter('dispatchId')] }),
    },
    '/dispatches/{dispatchId}/messages': {
      post: operation('sendMessage', 'MessageResponse', {
        body: 'SendMessage',
        parameters: [parameter('dispatchId')],
        status: '201',
      }),
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Server-issued CueMesh account token. Never an AI-provider API key.',
      },
    },
    schemas,
  },
};
const complete = getDemoDetail('demo-run-1');
const partial = getDemoDetail('demo-run-2');
const fixtures = {
  projects: { projects: demoProjects },
  runs: { runs: demoRuns },
  'run-complete': {
    run: {
      ...complete.run,
      tasks: complete.tasks,
      events: complete.events,
      artifacts: complete.artifacts,
    },
  },
  'run-partial': {
    run: {
      ...partial.run,
      tasks: partial.tasks,
      events: partial.events,
      artifacts: partial.artifacts,
    },
  },
  me: {
    user: {
      id: 'demo-user',
      email: 'demo@example.com',
      displayName: 'Ethan',
      createdAt: Date.UTC(2026, 10, 7),
    },
  },
  'shared-projects': { projects: [demoSharedProject] },
  devices: { devices: demoDevices },
  members: { members: demoMembers },
  dispatches: { dispatches: [demoDispatchDetail.dispatch] },
  'dispatch-detail': demoDispatchDetail,
};
const files: Record<string, unknown> = {
  'openapi.json': spec,
  ...Object.fromEntries(
    Object.entries(fixtures).map(([name, value]) => [`fixtures/${name}.json`, value]),
  ),
};
for (const [relative, value] of Object.entries(files)) {
  const output = JSON.stringify(value, null, 2) + '\n';
  const file = fileURLToPath(new URL(`../contracts/${relative}`, import.meta.url));
  if (process.argv.includes('--check')) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== output) {
      console.error(`contracts/${relative} differs from source. Run pnpm contract:generate.`);
      process.exitCode = 1;
    }
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, output);
  }
}
if (!process.exitCode)
  console.log(
    process.argv.includes('--check')
      ? 'Cloud v1 frontend schemas and fixtures match source.'
      : 'Generated cloud v1 frontend schemas and fixtures.',
  );
