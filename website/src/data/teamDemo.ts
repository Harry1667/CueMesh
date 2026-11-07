import type { Device, DispatchDetail, Member, Project } from '../lib/contracts';
const createdAt = Date.UTC(2026, 10, 7, 4, 0);
export const demoSharedProject: Project = {
  id: 'demo-cuemesh-team',
  name: 'CueMesh launch',
  description: 'Frontend and backend, working from the same brief.',
  createdAt,
  role: 'owner',
};
export const demoMembers: Member[] = [
  { userId: 'demo-user', displayName: 'Ethan', email: 'ethan@example.com', role: 'owner' },
  { userId: 'demo-harry', displayName: 'Harry', email: 'harry@example.com', role: 'member' },
];
export const demoDevices: Device[] = [
  {
    id: 'demo-front-device',
    userId: 'demo-user',
    ownerName: 'Ethan',
    name: 'Frontend · Chrome',
    platform: 'Windows',
    acceptRemote: 'ask',
    online: true,
    lastSeenAt: createdAt,
    mine: true,
  },
  {
    id: 'demo-back-device',
    userId: 'demo-harry',
    ownerName: 'Harry',
    name: 'Backend · Chrome',
    platform: 'macOS',
    acceptRemote: 'ask',
    online: false,
    lastSeenAt: createdAt - 1800000,
    mine: false,
  },
];
export const demoDispatchDetail: DispatchDetail = {
  dispatch: {
    id: 'demo-dispatch',
    projectId: demoSharedProject.id,
    targetDeviceId: 'demo-back-device',
    targetUserId: 'demo-harry',
    senderUserId: 'demo-user',
    senderName: 'Ethan',
    senderDeviceId: 'demo-front-device',
    crossAccount: true,
    goal: 'Confirm the account API fields so the frontend and backend can connect.',
    context: [
      {
        type: 'selection',
        title: 'Shared integration brief',
        text: 'The frontend owns website/. Harry owns server/ and extension/. Use the server account and Bearer authentication. Website and extension approve work within their own permissions.',
        url: 'https://github.com/Harry1667/CueMesh/blob/main/docs/cloud-api.md',
      },
    ],
    options: { maxCostUsd: 0.5 },
    parent: null,
    status: 'accepted',
    runId: null,
    summary: 'Sample handoff: backend interface review is in progress.',
    result: null,
    sources: [],
    error: null,
    costUsd: 0,
    createdAt: createdAt - 1800000,
    updatedAt: createdAt - 300000,
    expiresAt: createdAt + 600000,
  },
  messages: [
    {
      id: 'demo-question',
      dispatchId: 'demo-dispatch',
      fromUserId: 'demo-user',
      fromDeviceId: 'demo-front-device',
      kind: 'question',
      text: 'Which account fields should the frontend display after sign-in?',
      replyTo: null,
      createdAt: createdAt - 1500000,
    },
    {
      id: 'demo-answer',
      dispatchId: 'demo-dispatch',
      fromUserId: 'demo-harry',
      fromDeviceId: 'demo-back-device',
      kind: 'answer',
      text: 'The shared contract uses user.id, user.email, user.displayName, and user.createdAt. This is an illustrative conversation, not a real server reply.',
      replyTo: 'demo-question',
      createdAt: createdAt - 1200000,
    },
  ],
};
