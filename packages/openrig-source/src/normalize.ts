import type { Agent, AgentStatus, QueueItem, RigInfo } from '@backoffice/core';

/** The parts of OpenRig's answers that the office reads. Everything is optional: versions differ. */
export interface RawNode {
  nodeId?: string;
  rigName?: string;
  logicalId?: string;
  podNamespace?: string | null;
  canonicalSessionName?: string | null;
  nodeKind?: string;
  runtime?: string | null;
  model?: string | null;
  sessionStatus?: string | null;
  lastActivityAt?: string | null;
  agentActivity?: { state?: string; reason?: string | null; stale?: boolean } | null;
  activityState?: {
    activity?: string;
    display?: string;
    needsInput?: { count?: number; reason?: string | null } | null;
  } | null;
  assignedWorkCount?: number;
  pendingWorkCount?: number;
  inProgressWorkCount?: number;
  blockedWorkCount?: number;
  contextUsage?: { usedPercentage?: number | null } | null;
}

export interface RawRig {
  id?: string;
  name?: string;
  archivedAt?: string | null;
}

export interface RawQueueItem {
  qitemId?: string;
  summary?: string | null;
  state?: string;
  sourceSession?: string | null;
  destinationSession?: string | null;
  priority?: string | null;
  blockedOn?: string | null;
  tsUpdated?: string;
}

/**
 * OpenRig reports activity twice: `activityState` (the newer, arbitrated field)
 * and `agentActivity` (what the terminal looks like right now). They can
 * disagree for a moment, so a seat counts as waiting or working if either says so.
 */
export function statusOf(node: RawNode): { status: AgentStatus; reason: string | null } {
  const next = node.activityState;
  const legacy = node.agentActivity && !node.agentActivity.stale ? node.agentActivity : null;

  if ((next?.needsInput?.count ?? 0) > 0 || next?.display === 'needs-input' || legacy?.state === 'needs_input') {
    return { status: 'needs-input', reason: next?.needsInput?.reason ?? legacy?.reason ?? null };
  }
  if (next?.activity === 'working' || next?.display === 'working' || legacy?.state === 'running') {
    return { status: 'working', reason: legacy?.state === 'running' ? legacy.reason ?? null : null };
  }
  if (next?.display === 'idle' || next?.activity === 'idle-at-prompt' || legacy?.state === 'idle') {
    return { status: 'idle', reason: legacy?.state === 'idle' ? legacy.reason ?? null : null };
  }
  return { status: 'unknown', reason: null };
}

export function normalizeNode(node: RawNode): Agent | null {
  if (!node.nodeId || !node.canonicalSessionName) return null;
  const { status, reason } = statusOf(node);
  const pct = node.contextUsage?.usedPercentage;
  return {
    id: node.nodeId,
    name: node.logicalId ?? node.canonicalSessionName,
    session: node.canonicalSessionName,
    rig: node.rigName ?? 'unknown',
    pod: node.podNamespace ?? 'unassigned',
    kind: node.nodeKind === 'infrastructure' ? 'infrastructure' : 'agent',
    runtime: node.runtime ?? 'unknown',
    model: node.model ?? null,
    status,
    statusReason: reason,
    lastActivityAt: node.lastActivityAt ?? null,
    work: {
      assigned: node.assignedWorkCount ?? 0,
      pending: node.pendingWorkCount ?? 0,
      inProgress: node.inProgressWorkCount ?? 0,
      blocked: node.blockedWorkCount ?? 0,
    },
    contextUsedPct: typeof pct === 'number' && Number.isFinite(pct) ? Math.round(pct) : null,
  };
}

export function normalizeRigs(rigs: RawRig[]): RigInfo[] {
  return rigs
    .filter((r): r is RawRig & { id: string; name: string } => !!r.id && !!r.name && !r.archivedAt)
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeQueue(items: RawQueueItem[]): QueueItem[] {
  return items
    .filter((q) => !!q.qitemId)
    .map((q) => ({
      id: q.qitemId!,
      summary: (q.summary ?? '(no summary)').slice(0, 300),
      state: q.state ?? 'unknown',
      from: q.sourceSession ?? '',
      to: q.destinationSession ?? '',
      priority: q.priority ?? null,
      blockedOn: q.blockedOn ?? null,
      updatedAt: q.tsUpdated ?? '',
    }));
}
