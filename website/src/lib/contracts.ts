import { z } from 'zod';

// Mirrors docs/cloud-api.md + docs/integration-contract.md at c030293 (v1).
const id = z.string().min(1).max(200);
const timestamp = z.number().int().nonnegative().max(8640000000000000);
export const AgentSchema = z.enum([
  'research',
  'coding',
  '3d',
  'vision',
  'planning',
  'review',
  'browser',
]);
export const RunStatusSchema = z.enum([
  'planning',
  'running',
  'done',
  'partial',
  'failed',
  'cancelled',
]);
export const RoleSchema = z.enum(['owner', 'member']);
export const ProjectSchema = z.object({
  id,
  name: z.string(),
  description: z.string(),
  createdAt: timestamp,
  role: RoleSchema.optional(),
});
export const RunSchema = z.object({
  id,
  projectId: id,
  goal: z.string(),
  status: RunStatusSchema,
  mode: z.enum(['auto', 'council', 'workflow']),
  planSummary: z.string(),
  finalResult: z.string().nullable(),
  error: z.string().nullable(),
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  createdAt: timestamp,
  finishedAt: timestamp.nullable(),
});
export const TaskSchema = z.object({
  id,
  runId: id,
  parentTaskId: id.nullable(),
  title: z.string(),
  agent: AgentSchema,
  status: z.enum(['pending', 'running', 'done', 'failed']),
  provider: z.enum(['anthropic', 'openai', 'gemini']),
  model: z.string(),
  result: z.string().nullable(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  error: z.string().nullable(),
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
});
export const ArtifactSchema = z.object({
  id,
  runId: id,
  name: z.string(),
  kind: z.enum(['html', 'code', 'markdown', 'data']),
  content: z.string(),
  createdBy: AgentSchema,
  createdAt: timestamp,
});
export const EventSchema = z.object({
  seq: z.number().int().nonnegative(),
  runId: id,
  type: z.enum([
    'run_update',
    'plan',
    'task_created',
    'task_update',
    'agent_message',
    'tool_call',
    'browser_result',
    'mention',
    'fallback',
    'usage',
    'artifact',
    'notice',
    'mesh_dispatch',
    'mesh_report',
    'mesh_question',
    'mesh_answer',
    'run_finished',
  ]),
  payload: z.record(z.string(), z.unknown()),
  createdAt: timestamp,
});
export const UserSchema = z.object({
  id,
  email: z.string().email(),
  displayName: z.string(),
  createdAt: timestamp,
});
export const AuthResponseSchema = z.object({ token: z.string().min(1), user: UserSchema });
export const MeResponseSchema = z.object({ user: UserSchema });
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(1024),
});
export const RegisterRequestSchema = LoginRequestSchema.extend({
  displayName: z.string().trim().min(1).max(100),
  password: z.string().min(10).max(1024),
});
export const ProjectsResponseSchema = z.object({ projects: z.array(ProjectSchema) });
export const RunsResponseSchema = z.object({ runs: z.array(RunSchema) });
export const CloudRunSchema = RunSchema.extend({
  tasks: z.array(TaskSchema),
  artifacts: z.array(ArtifactSchema),
  events: z.array(EventSchema),
});
export const CloudRunResponseSchema = z.object({ run: CloudRunSchema });
// Internal normalized view model, not an invented HTTP envelope.
export const RunDetailSchema = z.object({
  run: RunSchema,
  tasks: z.array(TaskSchema),
  artifacts: z.array(ArtifactSchema),
  events: z.array(EventSchema),
  lastEventSeq: z.number().int().nonnegative(),
});
export const DeviceSchema = z.object({
  id,
  userId: id,
  ownerName: z.string(),
  name: z.string(),
  platform: z.string(),
  acceptRemote: z.enum(['off', 'ask', 'auto']),
  online: z.boolean(),
  lastSeenAt: timestamp.nullable(),
  mine: z.boolean(),
});
export const DevicesResponseSchema = z.object({ devices: z.array(DeviceSchema) });
export const MemberSchema = z.object({
  userId: id,
  displayName: z.string(),
  email: z.string().email(),
  role: RoleSchema,
});
export const MembersResponseSchema = z.object({ members: z.array(MemberSchema) });
export const ProjectResponseSchema = z.object({ project: ProjectSchema });
export const ProjectWriteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000),
});
export const InviteResponseSchema = z.object({ code: z.string().min(1), expiresAt: timestamp });
export const InviteAcceptSchema = z.object({ code: z.string().trim().min(1).max(1000) });
export const DispatchStatusSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
  'done',
  'partial',
  'failed',
  'cancelled',
  'expired',
]);
export const DispatchSchema = z.object({
  id,
  projectId: id,
  targetDeviceId: id,
  targetUserId: id,
  senderUserId: id,
  senderName: z.string(),
  senderDeviceId: id,
  crossAccount: z.boolean(),
  goal: z.string(),
  context: z.array(z.record(z.string(), z.unknown())),
  options: z.object({ maxCostUsd: z.number().nonnegative() }).passthrough(),
  parent: z.object({ runId: id, taskId: id }).nullable().optional(),
  status: DispatchStatusSchema,
  runId: id.nullable(),
  summary: z.string().nullable(),
  result: z.string().nullable(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  error: z.string().nullable(),
  costUsd: z.number().nonnegative(),
  createdAt: timestamp,
  updatedAt: timestamp,
  expiresAt: timestamp,
});
export const DispatchMessageSchema = z.object({
  id,
  dispatchId: id,
  fromUserId: id,
  fromDeviceId: id.nullable().optional(),
  kind: z.enum(['question', 'answer', 'progress']),
  text: z.string(),
  replyTo: id.nullable(),
  createdAt: timestamp,
});
export const DispatchesResponseSchema = z.object({ dispatches: z.array(DispatchSchema) });
export const DispatchDetailSchema = z.object({
  dispatch: DispatchSchema,
  messages: z.array(DispatchMessageSchema),
});
export const SendMessageSchema = z.object({
  id,
  kind: z.enum(['question', 'answer', 'progress']),
  text: z
    .string()
    .trim()
    .min(1)
    .refine((text) => new TextEncoder().encode(text).length <= 20 * 1024, 'Message exceeds 20 KB.'),
  replyTo: id.nullable(),
});
export const MessageResponseSchema = z.object({ message: DispatchMessageSchema });
export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }),
});

function validApiBase(value: string) {
  if (value === '/api') return true;
  try {
    const url = new URL(value);
    return (
      url.pathname === '/api' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
export const RuntimeConfigSchema = z.object({
  dataMode: z.enum(['demo', 'live']).default('demo'),
  apiBaseUrl: z
    .string()
    .refine(validApiBase, 'Use /api or an HTTPS API URL ending in /api.')
    .default('/api'),
  pollIntervalMs: z.number().int().min(2000).max(30000).default(3000),
  extensionInstallUrl: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === 'https:')
    .default('https://github.com/Harry1667/CueMesh#readme'),
});
export type Agent = z.infer<typeof AgentSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type TaskEvent = z.infer<typeof EventSchema>;
export type User = z.infer<typeof UserSchema>;
export type RunDetail = z.infer<typeof RunDetailSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type Dispatch = z.infer<typeof DispatchSchema>;
export type DispatchMessage = z.infer<typeof DispatchMessageSchema>;
export type DispatchDetail = z.infer<typeof DispatchDetailSchema>;

export function normalizeDetail(value: unknown, expectedRunId: string): RunDetail {
  const data = RunDetailSchema.parse(value);
  if (
    data.run.id !== expectedRunId ||
    [...data.tasks, ...data.artifacts, ...data.events].some((item) => item.runId !== expectedRunId)
  )
    throw new Error('The server returned records belonging to another run.');
  if (data.events.some((event) => event.seq > data.lastEventSeq))
    throw new Error('The event cursor is behind the returned snapshot.');
  for (const records of [data.tasks, data.artifacts])
    if (new Set(records.map((record) => record.id)).size !== records.length)
      throw new Error('The server returned duplicate records in a run snapshot.');
  const unique = new Map<number, TaskEvent>();
  for (const event of data.events) unique.set(event.seq, event);
  return { ...data, events: Array.from(unique.values()).sort((a, b) => a.seq - b.seq) };
}
