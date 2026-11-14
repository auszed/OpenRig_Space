import {
  assignSeats, buildLayout, byAttention, isOpenTask, emptySnapshot, groupByTeam, litDesks, locateAgents, whereabouts,
  type Agent, type AgentSettings, type Layout, type OfficeSnapshot, type OfficeTheme, type NewTask, type QueueItem, type Seat, type SettingsPatch, type SettingsSaved, type TeamGroup, type Whereabouts,
} from '@backoffice/core';
import type { FurnitureBuilder } from '../scene/build/kit.ts';
import { themeById } from '../themes.ts';

const THEME_KEY = 'backoffice.theme';
const BOARD_RIGS_KEY = 'backoffice.board.rigs';
const BOARD_OPACITY_KEY = 'backoffice.board.opacity';
const STALE_SERVER = 'The office server is older than this page. Restart it (bun run start) and try again.';

/** The server's catch-all answer for an API path it does not have: it runs older code than this page. */
function errorFrom(res: Response, body: { error?: string }, fallback: string): Error {
  return new Error(res.status === 404 && body.error === 'Not found.' ? STALE_SERVER : (body.error ?? fallback));
}

function opacityFrom(value: string | null): number {
  const n = Number(value);
  return value !== null && Number.isFinite(n) ? Math.min(Math.max(n, 0.4), 1) : 0.85;
}

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Everything the screen shows, fed by the server's WebSocket. */
export class OfficeStore {
  snapshot = $state.raw<OfficeSnapshot>(emptySnapshot('none', 'Connecting…'));
  connected = $state(false);
  selectedId = $state<string | null>(null);
  followId = $state<string | null>(null);
  /** The task board is open, and which rigs it shows (empty: all of them). */
  boardOpen = $state(false);
  boardRigs = $state<string[]>(this.rememberedRigs());
  /** How solid the task board is drawn, 0.4 to 1. */
  boardOpacity = $state(opacityFrom(remembered(BOARD_OPACITY_KEY)));
  themeId = $state(themeById(new URLSearchParams(location.search).get('theme') ?? remembered(THEME_KEY)).id);
  /** The floor plan, rebuilt only when rigs, pods or head counts change, never on a status change. */
  layout: Layout = $derived.by(() => this.planFor(this.snapshot.agents));
  private plan: { key: string; layout: Layout } | null = null;

  theme: OfficeTheme<FurnitureBuilder> = $derived(themeById(this.themeId));
  agents: Agent[] = $derived([...this.snapshot.agents].sort(byAttention));
  private assignment = $derived(assignSeats(this.snapshot.agents, this.layout));
  /** The desk each agent owns. */
  home: Map<string, Seat> = $derived(this.assignment.seats);
  /** Where each agent is right now: its desk, the lounge or the review room. */
  seats: Map<string, Seat> = $derived(locateAgents(this.snapshot.agents, this.snapshot.queue, this.layout, this.home));
  litDesks: Set<string> = $derived(litDesks(this.snapshot.agents, this.snapshot.queue, this.home));
  teams: TeamGroup[] = $derived(groupByTeam(this.snapshot.agents));
  /** Where each character is drawn this frame, written by the characters as they walk. Not reactive. */
  readonly live = new Map<string, { x: number; z: number }>();
  zoneLabels: Map<string, string[]> = $derived(this.assignment.zoneLabels);
  selected: Agent | null = $derived(this.snapshot.agents.find((a) => a.id === this.selectedId) ?? null);
  waiting: number = $derived(this.snapshot.agents.filter((a) => a.status === 'needs-input').length);
  /** One shirt colour per pod, stable for as long as the same pods exist. */
  podColor: Map<string, string> = $derived.by(() => {
    const pods = [...new Set(this.snapshot.agents.map((a) => `${a.rig}/${a.pod}`))].sort();
    const colors = this.theme.podColors;
    return new Map(pods.map((p, i) => [p, colors[i % colors.length]!]));
  });

  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  /** Same pods and head counts, same layout object, so nothing downstream rebuilds the building. */
  private planFor(agents: Agent[]): Layout {
    const key = agents.map((a) => `${a.rig}\u0000${a.pod}`).sort().join('\u0001');
    if (this.plan?.key !== key) this.plan = { key, layout: buildLayout(agents) };
    return this.plan.layout;
  }

  colorOf(agent: Agent): string {
    return this.podColor.get(`${agent.rig}/${agent.pod}`) ?? this.theme.podColors[0]!;
  }

  whereIs(agent: Agent): Whereabouts {
    return whereabouts(agent, this.snapshot.queue);
  }

  /** Open tasks this agent owns or sent; finished ones live on the board. */
  tasksFor(agent: Agent): QueueItem[] {
    return this.snapshot.queue.filter((q) => isOpenTask(q.state) && (q.to === agent.session || q.from === agent.session));
  }

  private rememberedRigs(): string[] {
    try {
      const saved = JSON.parse(localStorage.getItem(BOARD_RIGS_KEY) ?? '[]');
      return Array.isArray(saved) ? saved.filter((r) => typeof r === 'string') : [];
    } catch {
      return [];
    }
  }

  /** Shows the board for these rigs; no rigs means every team. */
  setBoardRigs(rigs: string[]): void {
    this.boardRigs = [...new Set(rigs)];
    try {
      localStorage.setItem(BOARD_RIGS_KEY, JSON.stringify(this.boardRigs));
    } catch {
      // Without storage the filter lasts for this visit only.
    }
  }

  setBoardOpacity(value: number): void {
    this.boardOpacity = opacityFrom(String(value));
    try {
      localStorage.setItem(BOARD_OPACITY_KEY, String(this.boardOpacity));
    } catch {
      // Without storage the choice lasts for this visit only.
    }
  }

  openBoard(rig?: string): void {
    if (rig) this.setBoardRigs([rig]);
    this.boardOpen = true;
  }

  async createTask(task: NewTask): Promise<void> {
    await this.post('/api/tasks', task, 'Task not created');
  }

  async cancelTask(id: string, reason: string): Promise<void> {
    await this.post(`/api/tasks/${encodeURIComponent(id)}/cancel`, { reason }, 'Task not cancelled');
  }

  async readWorkspace(): Promise<Record<string, string> | null> {
    const res = await fetch('/api/openrig/workspace');
    const body = await res.json().catch(() => ({}));
    return res.ok ? (body.workspace ?? null) : null;
  }

  private async post(url: string, payload: unknown, failure: string): Promise<unknown> {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw errorFrom(res, body, `${failure} (${res.status})`);
    return body;
  }

  setTheme(id: string): void {
    this.themeId = themeById(id).id;
    try {
      localStorage.setItem(THEME_KEY, this.themeId);
    } catch {
      // Private windows may refuse storage; the choice then lasts for this visit only.
    }
  }

  select(id: string | null): void {
    this.selectedId = id;
    if (id === null || (this.followId && this.followId !== id)) this.followId = null;
  }

  toggleFollow(id: string): void {
    this.followId = this.followId === id ? null : id;
  }

  connect(): void {
    this.closed = false;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/ws`);
    this.socket = socket;
    socket.onopen = () => (this.connected = true);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'snapshot') this.snapshot = message.snapshot;
      } catch {
        // A malformed frame is ignored; the next snapshot replaces everything anyway.
      }
    };
    socket.onclose = () => {
      this.connected = false;
      if (!this.closed) this.retry = setTimeout(() => this.connect(), 2000);
    };
  }

  disconnect(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.socket?.close();
  }

  async readScreen(agentId: string, lines = 40): Promise<string> {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/screen?lines=${lines}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Screen unavailable (${res.status})`);
    return body.content ?? '';
  }

  async sendMessage(agentId: string, text: string): Promise<void> {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Message not sent (${res.status})`);
    }
  }

  async readSettings(agentId: string): Promise<AgentSettings> {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/settings`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw errorFrom(res, body, `Settings unavailable (${res.status})`);
    return body;
  }

  async saveSettings(agentId: string, patch: SettingsPatch): Promise<SettingsSaved> {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw errorFrom(res, body, `Settings not saved (${res.status})`);
    return body;
  }

  /** Presses the digit of one choice in the question the agent is stopped at. */
  async answerPrompt(agentId: string, key: string, label: string): Promise<void> {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, label }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Answer not sent (${res.status})`);
    }
  }
}
