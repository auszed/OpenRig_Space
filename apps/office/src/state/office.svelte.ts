import {
  assignSeats, byAttention, defaultLayout, emptySnapshot,
  type Agent, type Layout, type OfficeSnapshot, type OfficeTheme, type QueueItem, type Seat,
} from '@backoffice/core';
import type { FurnitureBuilder } from '../scene/build/kit.ts';
import { themeById } from '../themes.ts';

const THEME_KEY = 'backoffice.theme';

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
  themeId = $state(themeById(new URLSearchParams(location.search).get('theme') ?? remembered(THEME_KEY)).id);
  readonly layout: Layout = defaultLayout();

  theme: OfficeTheme<FurnitureBuilder> = $derived(themeById(this.themeId));
  agents: Agent[] = $derived([...this.snapshot.agents].sort(byAttention));
  private assignment = $derived(assignSeats(this.snapshot.agents, this.layout));
  seats: Map<string, Seat> = $derived(this.assignment.seats);
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

  colorOf(agent: Agent): string {
    return this.podColor.get(`${agent.rig}/${agent.pod}`) ?? this.theme.podColors[0]!;
  }

  tasksFor(agent: Agent): QueueItem[] {
    return this.snapshot.queue.filter((q) => q.to === agent.session || q.from === agent.session);
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
}
