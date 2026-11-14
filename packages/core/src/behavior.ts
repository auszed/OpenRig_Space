import type { Agent, QueueItem } from './model.ts';

export type Pose = 'typing' | 'sitting' | 'alert' | 'away';

export interface Behavior {
  pose: Pose;
  screenOn: boolean;
  /** Text for the bubble above the head, or null for no bubble. */
  bubble: string | null;
}

const REASONS: Record<string, string> = {
  permission_prompt: 'Waiting for a permission',
  selection_prompt: 'Waiting for your choice',
  usage_limit: 'Hit a usage limit',
  idle_prompt: 'At the prompt',
};

export function reasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return REASONS[reason] ?? reason.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** What a status looks like in the office. Themes decide how it is drawn, not what it means. */
export function behaviorFor(agent: Pick<Agent, 'status' | 'statusReason'>): Behavior {
  switch (agent.status) {
    case 'working':
      return { pose: 'typing', screenOn: true, bubble: null };
    case 'idle':
      return { pose: 'sitting', screenOn: false, bubble: null };
    case 'needs-input':
      return { pose: 'alert', screenOn: true, bubble: reasonLabel(agent.statusReason) ?? 'Needs you' };
    default:
      return { pose: 'away', screenOn: false, bubble: null };
  }
}

const ORDER: Record<Agent['status'], number> = { 'needs-input': 0, working: 1, idle: 2, unknown: 3 };

/** Agents that need the person first, then the busy ones, then the rest. */
export function byAttention(a: Agent, b: Agent): number {
  return ORDER[a.status] - ORDER[b.status] || a.rig.localeCompare(b.rig) || a.name.localeCompare(b.name);
}

/** The agent a rig answers to: "orch.lead", "advisor.lead", or anyone in a pod called "lead". */
export function isLead(agent: Pick<Agent, 'name' | 'pod'>): boolean {
  return /(^|\.)lead$/i.test(agent.name) || agent.pod.toLowerCase() === 'lead';
}

const CLOSED = /^(done|closed|complete|completed|cancell?ed|merged|failed|archived|resolved)$/i;
const PR_TALK = /\bprs?\b|pull[\s-]?request|\breview(s|ed|ing)?\b/i;

/**
 * True when an open queue item this agent sent or received talks about a pull
 * request or a review. The source has no PR state, so this reads the words.
 */
export function waitingOnPr(agent: Pick<Agent, 'session'>, queue: QueueItem[]): boolean {
  return queue.some(
    (q) =>
      (q.to === agent.session || q.from === agent.session) &&
      !CLOSED.test(q.state) &&
      PR_TALK.test(`${q.summary} ${q.blockedOn ?? ''} ${q.state}`),
  );
}

export type Whereabouts = 'desk' | 'review' | 'lounge';

/**
 * Where an agent is in the office. Busy agents, and agents stopped at a
 * question in their terminal, are at their desk. The rest wait: in the PR
 * review room if a pull request is what they wait for, otherwise in the lounge.
 */
export function whereabouts(agent: Pick<Agent, 'status' | 'session'>, queue: QueueItem[]): Whereabouts {
  if (agent.status === 'working' || agent.status === 'needs-input') return 'desk';
  return waitingOnPr(agent, queue) ? 'review' : 'lounge';
}

export interface PodGroup {
  pod: string;
  agents: Agent[];
}

export interface TeamGroup {
  rig: string;
  lead: Agent | null;
  pods: PodGroup[];
  size: number;
}

/**
 * Agents by rig, then pod. The lead's pod comes first and the lead first in
 * it; everything else is alphabetical, so rows stay put when a status changes.
 */
export function groupByTeam(agents: Agent[]): TeamGroup[] {
  const rigs = new Map<string, Map<string, Agent[]>>();
  for (const a of agents) {
    const pods = rigs.get(a.rig) ?? new Map<string, Agent[]>();
    rigs.set(a.rig, pods);
    pods.set(a.pod, [...(pods.get(a.pod) ?? []), a]);
  }
  const leadFirst = (a: Agent, b: Agent) =>
    Number(isLead(b)) - Number(isLead(a)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  return [...rigs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rig, podMap]) => {
      const pods = [...podMap.entries()]
        .map(([pod, members]) => ({ pod, agents: [...members].sort(leadFirst) }))
        .sort((a, b) => Number(isLead(b.agents[0]!)) - Number(isLead(a.agents[0]!)) || a.pod.localeCompare(b.pod));
      const first = pods[0]?.agents[0];
      return {
        rig,
        lead: first && isLead(first) ? first : null,
        pods,
        size: pods.reduce((n, p) => n + p.agents.length, 0),
      };
    });
}
