import type { Agent, AgentStatus, OfficeSnapshot } from './model.ts';
import type { OfficeSource } from './source.ts';

const SEATS: Array<[rig: string, pod: string, name: string, status: AgentStatus, reason: string | null]> = [
  ['demo', 'lead', 'lead.planner', 'working', null],
  ['demo', 'build', 'build.api', 'working', null],
  ['demo', 'build', 'build.web', 'needs-input', 'permission_prompt'],
  ['demo', 'qa', 'qa.runner', 'idle', 'idle_prompt'],
  ['demo', 'qa', 'qa.reviewer', 'working', null],
  ['demo', 'docs', 'docs.writer', 'unknown', null],
  ['kernel', 'operator', 'operator.agent', 'idle', 'idle_prompt'],
  ['kernel', 'queue', 'queue.worker', 'idle', 'idle_prompt'],
];

/** A made-up office, for developing and testing without a running OpenRig. */
export class MockSource implements OfficeSource {
  readonly name = 'mock';
  readonly sent: Array<{ session: string; text: string }> = [];
  readonly answered: Array<{ session: string; key: string }> = [];
  private listeners = new Set<() => void>();
  private agents: Agent[] = SEATS.map(([rig, pod, name, status, reason], i) => ({
    id: `mock-${i + 1}`,
    name,
    session: `${name.replace('.', '-')}@${rig}`,
    rig,
    pod,
    kind: 'agent',
    runtime: 'mock',
    model: null,
    status,
    statusReason: reason,
    lastActivityAt: null,
    work: { assigned: i % 3, pending: 0, inProgress: i % 2, blocked: 0 },
    contextUsedPct: 10 + i * 9,
  }));

  async snapshot(): Promise<OfficeSnapshot> {
    return {
      generatedAt: new Date().toISOString(),
      source: this.name,
      rigs: [...new Set(this.agents.map((a) => a.rig))].map((name) => ({ id: name, name })),
      agents: this.agents.map((a) => ({ ...a, work: { ...a.work } })),
      queue: [
        {
          id: 'mock-q1', summary: 'Wire the login form to the API', state: 'in-progress',
          from: this.agents[0]!.session, to: this.agents[2]!.session, priority: 'routine',
          blockedOn: null, updatedAt: new Date(0).toISOString(),
        },
      ],
      health: { ok: true, message: null },
    };
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  /** Test hook: change one agent and tell subscribers. */
  setStatus(id: string, status: AgentStatus, reason: string | null = null): void {
    const agent = this.agents.find((a) => a.id === id);
    if (!agent) throw new Error(`no mock agent ${id}`);
    agent.status = status;
    agent.statusReason = reason;
    for (const l of this.listeners) l();
  }

  async readScreen(session: string, lines: number): Promise<string> {
    if (this.agents.find((a) => a.session === session)?.status === 'needs-input') {
      return `(mock screen for ${session})\n Bash command\n rm -rf build\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. Yes, and don't ask again\n   3. No\n`;
    }
    return `(mock screen for ${session}, last ${lines} lines)\n> compiling...\n> 12 tests passed`;
  }

  async sendMessage(session: string, text: string): Promise<void> {
    this.sent.push({ session, text });
  }

  async answerPrompt(session: string, key: string): Promise<void> {
    this.answered.push({ session, key });
    const agent = this.agents.find((a) => a.session === session);
    if (agent) this.setStatus(agent.id, 'working');
  }
}
