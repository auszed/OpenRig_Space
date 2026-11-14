/** A small client for the OpenRig daemon's local HTTP API (REST + server-sent events). */

export interface OpenRigClientOptions {
  /** e.g. "http://127.0.0.1:7433" */
  baseUrl: string;
  /** Only needed if the daemon was started with bearer tokens. */
  token?: string;
  fetch?: typeof fetch;
}

export class OpenRigError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export class OpenRigClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: OpenRigClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.doFetch = opts.fetch ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}), ...extra };
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { headers: this.headers({ accept: 'application/json' }) });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json', accept: 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.doFetch(this.base + path, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new OpenRigError(`OpenRig daemon not reachable at ${this.base}: ${(err as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new OpenRigError(`OpenRig ${path} answered ${res.status}: ${text.slice(0, 200)}`, res.status);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new OpenRigError(`OpenRig ${path} did not answer with JSON`, res.status);
    }
  }

  /**
   * Follows a server-sent event stream until the returned function is called.
   * Reconnects with a growing pause and resumes after the last event it saw.
   */
  events(path: string, onEvent: (data: string) => void): () => void {
    const stop = new AbortController();
    let lastId: string | null = null;

    const run = async () => {
      let pause = 500;
      while (!stop.signal.aborted) {
        try {
          const res = await this.doFetch(this.base + path, {
            headers: this.headers({ accept: 'text/event-stream', ...(lastId ? { 'last-event-id': lastId } : {}) }),
            signal: stop.signal,
          });
          if (!res.ok || !res.body) throw new OpenRigError(`stream ${path} answered ${res.status}`, res.status);
          pause = 500;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let cut: number;
            while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
              const block = buffer.slice(0, cut);
              buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '');
              const parsed = parseEvent(block);
              if (parsed.id !== null) lastId = parsed.id;
              if (parsed.data !== null) onEvent(parsed.data);
            }
          }
        } catch {
          // Fall through to the pause; the fallback poll covers the gap.
        }
        if (stop.signal.aborted) return;
        await new Promise((r) => setTimeout(r, pause));
        pause = Math.min(pause * 2, 15_000);
      }
    };
    void run();
    return () => stop.abort();
  }
}

export function parseEvent(block: string): { id: string | null; data: string | null } {
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  return { id, data: data.length ? data.join('\n') : null };
}
