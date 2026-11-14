import {
  assignSeats, buildLayout, byAttention, isOpenTask, emptySnapshot, groupByTeam, litDesks, locateAgents, whereabouts,
  type Agent, type AgentSettings, type Layout, type OfficeSnapshot, type OfficeTheme, type NewTask, type QueueItem, type Seat, type SettingsPatch, type SettingsSaved, type TeamGroup, type Whereabouts,
} from '@backoffice/core';
import type { FurnitureBuilder } from '../scene/build/kit.ts';
import { themeById } from '../themes.ts';

const THEME_KEY = 'backoffice.theme';
const BOARD_RIGS_KEY = 'backoffice.board.rigs';
const BOARD_OPACITY_KEY = 'backoffice.board.opacity';
const GLOW_KEY = 'backoffice.glow';
/** How long everyone stays at their desks once they have all sat down, after "Everyone to desks". */
export const RALLY_SECONDS = 5;
/** If someone cannot reach their desk, the rally counts down anyway after this long. */
const RALLY_WALK_LIMIT_MS = 40_000;
const STALE_SERVER = 'The office server is older than this page. Restart it (bun run start) and try again.';

/** The server's catch-all answer for an API path it does not have: it runs older code than this page. */
function errorFrom(res: Response, body: { error?: string }, fallback: string): Error {
  return new Error(res.status === 404 && body.error === 'Not found.' ? STALE_SERVER : (body.error ?? fallback));
}

function opacityFrom(value: string | null): number {
  const n = Number(value);
  return value !== null && Number.isFinite(n) ? Math.min(Math.max(n, 0.4), 1) : 0.85;
}

/** Brightness of the night glow, each 1 by default (the theme's own value), 0 to 2. */
export interface GlowLevels { lines: number; floor: number; screens: number }
const GLOW_DEFAULT: GlowLevels = { lines: 1, floor: 1, screens: 1 };

function glowFrom(value: string | null): GlowLevels {
  try {
    const saved = JSON.parse(value ?? '{}') as Partial<Record<keyof GlowLevels, unknown>>;
    const level = (n: unknown, fallback: number) =>
      typeof n === 'number' && Number.isFinite(n) ? Math.min(Math.max(n, 0), 2) : fallback;
    return { lines: level(saved.lines, 1), floor: level(saved.floor, 1), screens: level(saved.screens, 1) };
  } catch {
    return { ...GLOW_DEFAULT };
  }
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
  /** The View menu's glow sliders, multiplying the theme's neon and screen light. */
  glowLevels = $state<GlowLevels>(glowFrom(remembered(GLOW_KEY)));
  /**
   * "Everyone to desks": `going` while they walk there, `there` while they sit for a few seconds
   * (`rallyLeft` counts down), then everyone goes back to where OpenRig says they are.
   */
  rally = $state<'off' | 'going' | 'there'>('off');
  rallyLeft = $state(0);
  private rallyTimer: ReturnType<typeof setInterval> | null = null;
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
  seats: Map<string, Seat> = $derived.by(() => {
    const located = locateAgents(this.snapshot.agents, this.snapshot.queue, this.layout, this.home);
    if (this.rally === 'off') return located;
    return new Map([...located, ...this.home]);
  });
  litDesks: Set<string> = $derived(
    this.rally === 'off'
      ? litDesks(this.snapshot.agents, this.snapshot.queue, this.home)
      : new Set([...this.home.values()].flatMap((s) => (s.deskId ? [s.deskId] : []))),
  );
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

  setGlow(levels: Partial<GlowLevels>): void {
    this.glowLevels = glowFrom(JSON.stringify({ ...this.glowLevels, ...levels }));
    try {
      localStorage.setItem(GLOW_KEY, JSON.stringify(this.glowLevels));
    } catch {
      // Without storage the choice lasts for this visit only.
    }
  }

  resetGlow(): void {
    this.setGlow(GLOW_DEFAULT);
  }

  /**
   * Sends every agent to its own desk, screens on, and keeps them there for RALLY_SECONDS once
   * all of them have sat down. Only the picture changes; OpenRig and the agents are not touched.
   */
  callRally(): void {
    this.endRally();
    this.rally = 'going';
    const started = Date.now();
    let sitUntil = 0;
    this.rallyTimer = setInterval(() => {
      if (this.rally === 'going') {
        const seated = [...this.home].every(([id, desk]) => {
          const at = this.live.get(id);
          return !at || Math.hypot(at.x - desk.x, at.z - desk.z) < 0.05;
        });
        if (!seated && Date.now() - started < RALLY_WALK_LIMIT_MS) return;
        this.rally = 'there';
        sitUntil = Date.now() + RALLY_SECONDS * 1000;
      }
      this.rallyLeft = Math.max(0, Math.ceil((sitUntil - Date.now()) / 1000));
      if (Date.now() >= sitUntil) this.endRally();
    }, 200);
  }

  /** Everyone goes back to where OpenRig says they are. */
  endRally(): void {
    if (this.rallyTimer) clearInterval(this.rallyTimer);
    this.rallyTimer = null;
    this.rally = 'off';
    this.rallyLeft = 0;
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
