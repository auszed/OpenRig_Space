import type { Agent, AgentStatus, OfficeSnapshot, QueueItem } from './model.ts';
import type { OfficeSource } from './source.ts';
import { rigOfSession, TaskError, type NewTask, type TaskCreated, type TaskStore } from './tasks.ts';

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
export class MockSource implements OfficeSource, TaskStore {
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

  private queue: QueueItem[] = (() => {
    const s = (i: number) => this.agents[i]!.session;
    const row = (id: string, summary: string, state: string, from: string, to: string, blockedOn: string | null = null, priority = 'routine'): QueueItem =>
      ({ id, summary, state, from, to, rig: rigOfSession(to), priority, blockedOn, updatedAt: new Date().toISOString() });
    return [
      row('mock-q1', 'Wire the login form to the API', 'in-progress', s(0), s(2)),
      row('mock-q2', 'PR #42: smoke tests for the login form', 'pending', s(3), s(4), 'review'),
      row('mock-q3', 'Pick the colour palette for the docs site', 'blocked', s(0), s(5), 'decision from the person', 'urgent'),
      row('mock-q4', 'Rotate the kernel log files', 'done', s(6), s(7)),
    ];
  })();
  private created = 0;

  async create(task: NewTask): Promise<TaskCreated> {
    if (!this.agents.some((a) => a.session === task.destination)) throw new TaskError(`There is no agent "${task.destination}".`, 404);
    const id = `mock-t${++this.created}`;
    this.queue.unshift({
      id, summary: task.summary, state: 'pending', from: 'person@external', to: task.destination,
      rig: rigOfSession(task.destination), priority: task.priority, blockedOn: null, updatedAt: new Date().toISOString(),
    });
    for (const l of this.listeners) l();
    return { id };
  }

  async cancel(id: string): Promise<void> {
    const row = this.queue.find((q) => q.id === id);
    if (!row) throw new TaskError(`There is no task "${id}".`, 404);
    row.state = 'done';
    row.updatedAt = new Date().toISOString();
    for (const l of this.listeners) l();
  }

  async snapshot(): Promise<OfficeSnapshot> {
    return {
      generatedAt: new Date().toISOString(),
      source: this.name,
      rigs: [...new Set(this.agents.map((a) => a.rig))].map((name) => ({ id: name, name })),
      agents: this.agents.map((a) => ({ ...a, work: { ...a.work } })),
      queue: this.queue.map((q) => ({ ...q })),
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
