/** The office as data. Nothing here knows about OpenRig, three.js or Svelte. */

export type AgentStatus = 'working' | 'idle' | 'needs-input' | 'unknown';

export interface Agent {
  /** Stable id of the seat (survives a change of occupant). */
  id: string;
  /** Short name shown on the name tag, e.g. "orch.lead". */
  name: string;
  /** Address used to read the screen of, or talk to, this agent. */
  session: string;
  rig: string;
  pod: string;
  kind: 'agent' | 'infrastructure';
  runtime: string;
  model: string | null;
  status: AgentStatus;
  /** Why it is in that status, as the source reports it (e.g. "permission_prompt"). */
  statusReason: string | null;
  lastActivityAt: string | null;
  work: { assigned: number; pending: number; inProgress: number; blocked: number };
  /** 0-100, or null when the source cannot tell. */
  contextUsedPct: number | null;
}

export interface QueueItem {
  id: string;
  summary: string;
  state: string;
  from: string;
  to: string;
  priority: string | null;
  blockedOn: string | null;
  updatedAt: string;
}

export interface RigInfo {
  id: string;
  name: string;
}

export interface OfficeSnapshot {
  generatedAt: string;
  /** Which source produced this ("openrig", "mock"). */
  source: string;
  rigs: RigInfo[];
  agents: Agent[];
  queue: QueueItem[];
  health: { ok: boolean; message: string | null };
}

export function emptySnapshot(source: string, message: string | null = null): OfficeSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    source,
    rigs: [],
    agents: [],
    queue: [],
    health: { ok: message === null, message },
  };
}
