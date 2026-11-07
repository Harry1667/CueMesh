import { normalizeDetail, type Project, type Run, type RunDetail } from '../lib/contracts';
import { demoModelRouting } from './modelRouting';

const createdAt = Date.UTC(2026, 10, 7, 3, 0);
export const demoProjects: Project[] = [
  {
    id: 'demo-materials',
    name: 'Materials atlas',
    description: 'Interactive material library.',
    createdAt,
  },
  {
    id: 'demo-research',
    name: 'Research notebook',
    description: 'A place for source-backed comparisons.',
    createdAt: createdAt - 86400000,
  },
];
export const demoRuns: Run[] = [
  {
    id: 'demo-run-1',
    projectId: 'demo-materials',
    goal: 'Build a materials explorer.',
    status: 'done',
    mode: 'auto',
    planSummary: 'Research → Build → Review.',
    finalResult: 'Preview + direction notes.\n\nAuthored sample files. No agents ran in this demo.',
    error: null,
    costUsd: 0.0184,
    inputTokens: 2400,
    outputTokens: 1650,
    createdAt,
    finishedAt: createdAt + 96000,
  },
  {
    id: 'demo-run-2',
    projectId: 'demo-materials',
    goal: 'Review the reference.',
    status: 'partial',
    mode: 'council',
    planSummary: 'Compare two viewpoints and collect the useful disagreements.',
    finalResult:
      'The layout review is complete. The second viewpoint could not be retrieved, so this run is only partially complete.',
    error: 'Example: the second provider reached its request limit.',
    costUsd: 0.0042,
    inputTokens: 700,
    outputTokens: 340,
    createdAt: createdAt - 3600000,
    finishedAt: createdAt - 3520000,
  },
];

const previewHtml = `<style>body{margin:0;padding:32px;background:#f6f5fa;color:#151c33;font:14px system-ui}small{letter-spacing:.15em;color:#626a80}h1{font-size:34px;letter-spacing:-1.5px;font-weight:500}.samples{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.sample{border:1px solid #dee0eb;padding:14px;border-radius:5px}.shape{height:110px;background:#b5a5ef;border-radius:70% 40% 60% 45%;margin:10px}.sample:nth-child(2) .shape{background:#8095f0;border-radius:5px}.sample:nth-child(3) .shape{background:#d4d9ed;border-radius:50%}p{line-height:1.7;color:#626a80}@media(max-width:400px){body{padding:18px}.samples{grid-template-columns:1fr}.shape{height:60px}}</style><small>ILLUSTRATIVE ARTIFACT</small><h1>Materials, in perspective.</h1><div class="samples"><div class="sample"><div class="shape"></div>Ceramic</div><div class="sample"><div class="shape"></div>Metal</div><div class="sample"><div class="shape"></div>Wood</div></div><p>A static composition demonstrating how an HTML artifact appears in CueMesh. It does not execute scripts.</p>`;

export function getDemoDetail(runId: string): RunDetail {
  const run = demoRuns.find((item) => item.id === runId) ?? demoRuns[0];
  const partial = run.status === 'partial';
  return normalizeDetail(
    {
      run,
      tasks: [
        {
          id: 'task-research',
          runId: run.id,
          parentTaskId: null,
          title: 'Establish the direction',
          agent: 'research',
          status: 'done',
          provider: demoModelRouting.research.provider,
          model: demoModelRouting.research.primary,
          result:
            'Keep the first iteration focused on three material families, readable details, and a single interaction surface. This text is sample content.',
          sources: [
            { title: 'Project source repository', url: 'https://github.com/Harry1667/CueMesh' },
          ],
          error: null,
          startedAt: run.createdAt,
          finishedAt: run.createdAt + 24000,
        },
        {
          id: 'task-build',
          runId: run.id,
          parentTaskId: 'task-research',
          title: 'Shape the first version',
          agent: 'coding',
          status: 'done',
          provider: 'anthropic',
          model: demoModelRouting.coding.primary,
          result: partial
            ? 'A sample layout review is complete. No artifact is attached to this partial run.'
            : 'A static reference artifact is attached to illustrate the result view. This is authored sample content, not generated work.',
          sources: [],
          error: null,
          startedAt: run.createdAt + 24000,
          finishedAt: run.createdAt + 72000,
        },
        {
          id: 'task-review',
          runId: run.id,
          parentTaskId: 'task-build',
          title: 'Close the loop',
          agent: 'review',
          status: partial ? 'failed' : 'done',
          provider: 'openai',
          model: demoModelRouting.review.primary,
          result: partial
            ? null
            : 'The example review notes the need for keyboard navigation, source attribution, and real testing before release. This is not a recorded test result.',
          sources: [],
          error: partial ? 'Example provider request limit.' : null,
          startedAt: run.createdAt + 72000,
          finishedAt: run.finishedAt,
        },
      ],
      artifacts: partial
        ? []
        : [
            {
              id: 'artifact-html',
              runId: run.id,
              name: 'materials-preview.html',
              kind: 'html',
              content: previewHtml,
              createdBy: 'coding',
              createdAt: run.createdAt + 72000,
            },
            {
              id: 'artifact-notes',
              runId: run.id,
              name: 'direction-notes.md',
              kind: 'markdown',
              content:
                '# Direction notes\n\nThis sample keeps the first prototype intentionally small.\n\n- Three material families\n- A focused viewing area\n- Details available on selection\n- Keyboard navigation to be verified in the real implementation\n\nThese are illustrative notes, not results from a real research run.',
              createdBy: 'research',
              createdAt: run.createdAt + 24000,
            },
          ],
      events: [
        {
          seq: 1,
          runId: run.id,
          type: 'plan',
          payload: { summary: run.planSummary, tasks: [], estimatedCostUsd: 0.02 },
          createdAt: run.createdAt,
        },
        {
          seq: 2,
          runId: run.id,
          type: 'agent_message',
          payload: {
            taskId: 'task-research',
            text: 'I’ll keep the initial scope to three material families.',
          },
          createdAt: run.createdAt + 15000,
        },
        {
          seq: 3,
          runId: run.id,
          type: 'mention',
          payload: {
            fromTaskId: 'task-research',
            fromAgent: 'research',
            toTaskId: 'task-build',
            agent: 'coding',
            request: 'Use the shared direction notes for the first interface.',
          },
          createdAt: run.createdAt + 24000,
        },
        {
          seq: 4,
          runId: run.id,
          type: 'artifact',
          payload: {
            artifactId: 'artifact-html',
            name: 'materials-preview.html',
            kind: 'html',
            createdBy: 'coding',
          },
          createdAt: run.createdAt + 72000,
        },
        {
          seq: 5,
          runId: run.id,
          type: 'mention',
          payload: {
            fromTaskId: 'task-build',
            fromAgent: 'coding',
            toTaskId: 'task-review',
            agent: 'review',
            request: 'Check the result against the initial brief.',
          },
          createdAt: run.createdAt + 73000,
        },
        {
          seq: 6,
          runId: run.id,
          type: 'run_finished',
          payload: { status: run.status, ...(run.error ? { error: run.error } : {}) },
          createdAt: run.finishedAt ?? run.createdAt,
        },
      ].filter((event) => !partial || event.type !== 'artifact'),
      lastEventSeq: 6,
    },
    run.id,
  );
}
