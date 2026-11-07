// 路由：依工作類型、使用者有的 API key、團隊設定與實際表現，決定模型嘗試順序
import { ROUTES, MODELS, parseModelRef } from './catalog.js';

const MIN_SAMPLES_TO_DEMOTE = 3;

// stats：這位使用者在這類工作的紀錄 [{ provider, model, successes, failures }]
export function pickCandidates({ agentType, availableProviders, teamPref, forcedProvider, stats = [] }) {
  const route = ROUTES[agentType];
  if (!route) throw new Error(`未知的 agent 類型：${agentType}`);

  const refs = teamPref ? [teamPref, ...route.filter((r) => r !== teamPref)] : [...route];
  let candidates = refs
    .map(parseModelRef)
    .filter((c) => availableProviders.includes(c.provider))
    .filter((c) => !forcedProvider || c.provider === forcedProvider);

  // 表現學習：近期明顯失敗的模型往後排，但不移除（團隊指定的模型維持第一順位）
  const isWeak = (c) => {
    const s = stats.find((x) => x.provider === c.provider && x.model === c.model);
    if (!s) return false;
    const total = s.successes + s.failures;
    return total >= MIN_SAMPLES_TO_DEMOTE && s.failures > s.successes;
  };
  const pinned = teamPref ? candidates.filter((c) => `${c.provider}/${c.model}` === teamPref) : [];
  const rest = candidates.filter((c) => !pinned.includes(c));
  candidates = [...pinned, ...rest.filter((c) => !isWeak(c)), ...rest.filter(isWeak)];

  return candidates.map((c) => ({ ...c, info: MODELS.find((m) => m.provider === c.provider && m.id === c.model) }));
}

export function estimateCost(model, inputTokens, outputTokens) {
  if (!model) return 0;
  return (inputTokens * model.inputPer1M + outputTokens * model.outputPer1M) / 1_000_000;
}

const PROVIDER_ALIASES = { openai: 'openai', anthropic: 'anthropic', claude: 'anthropic', gemini: 'gemini', google: 'gemini' };
const AGENT_MENTIONS = new Set(['research', 'coding', '3d', 'vision', 'review', 'browser', 'planning']);

// 解析使用者打的 @mention：@research 指定 agent，@claude 指定供應商，@auto 交給規劃器
export function parseMentions(goal) {
  const agents = new Set();
  let provider = null;
  for (const match of goal.matchAll(/(?:^|\s)@([a-z0-9]+)\b/gi)) {
    const word = match[1].toLowerCase();
    if (AGENT_MENTIONS.has(word)) agents.add(word);
    else if (PROVIDER_ALIASES[word]) provider = PROVIDER_ALIASES[word];
  }
  return { agents: [...agents], provider };
}
