import type { OfficeSnapshot, OfficeSource } from '@backoffice/core';
import { OpenRigClient, OpenRigError, type OpenRigClientOptions } from './client.ts';
import { normalizeNode, normalizeQueue, normalizeRigs, type RawNode, type RawQueueItem, type RawRig } from './normalize.ts';

/** Drives the office from a running OpenRig daemon. Reads through its HTTP API only. */
export class OpenRigSource implements OfficeSource {
  readonly name = 'openrig';
  private readonly client: OpenRigClient;

  constructor(opts: OpenRigClientOptions) {
    this.client = new OpenRigClient(opts);
  }

  async snapshot(): Promise<OfficeSnapshot> {
    const rigs = normalizeRigs(await this.client.get<RawRig[]>('/api/rigs/summary'));
    const [nodeLists, queue] = await Promise.all([
      Promise.all(rigs.map((r) => this.client.get<RawNode[]>(`/api/rigs/${encodeURIComponent(r.id)}/nodes`))),
      // The queue is a nice-to-have: an office without the task list is still an office.
      this.client.get<RawQueueItem[]>('/api/queue/list?activeOnly=1&limit=200&sort=updated').catch(() => null),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      source: this.name,
      rigs,
      agents: nodeLists.flat().map(normalizeNode).filter((a) => a !== null),
      queue: normalizeQueue(Array.isArray(queue) ? queue : []),
      health: queue === null ? { ok: true, message: 'Task list unavailable' } : { ok: true, message: null },
    };
  }

  subscribe(onChange: () => void): () => void {
    // Both streams are treated as "something changed": the snapshot is re-read, never patched.
    const stops = [
      this.client.events('/api/events?replay=0', onChange),
      this.client.events('/api/queue/sse', onChange),
    ];
    return () => stops.forEach((stop) => stop());
  }

  async readScreen(session: string, lines: number): Promise<string> {
    const res = await this.client.get<{ content?: string }>(
      `/api/sessions/${encodeURIComponent(session)}/preview?lines=${lines}`,
    );
    return res.content ?? '';
  }

  async sendMessage(session: string, text: string): Promise<void> {
    const res = await this.client.post<{ ok?: boolean; sent?: boolean; error?: string; reason?: string }>(
      '/api/transport/send',
      { session, text },
    );
    if (res.ok === false || res.sent === false) {
      throw new OpenRigError(`OpenRig did not deliver the message: ${res.error ?? res.reason ?? 'no reason given'}`);
    }
  }

  async answerPrompt(session: string, key: string): Promise<void> {
    // OpenRig refuses ordinary sends into an open prompt. Answering one is its explicit,
    // audited "interact" path, which needs a reason for the record.
    const res = await this.client.post<{ ok?: boolean; sent?: boolean; error?: string; reason?: string }>(
      '/api/transport/send',
      { session, text: key, dangerouslyInteract: true, reason: 'Choice picked by the person in OpenRig Space' },
    );
    if (res.ok === false || res.sent === false) {
      throw new OpenRigError(`OpenRig did not deliver the answer: ${res.error ?? res.reason ?? 'no reason given'}`);
    }
  }
}
