import type { Agent } from './model.ts';

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
