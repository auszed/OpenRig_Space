import { resolve, sep } from 'node:path';
import { emptySnapshot, parsePromptOptions, type OfficeSnapshot, type OfficeSource } from '@backoffice/core';

export interface ServerOptions {
  source: OfficeSource;
  port: number;
  /** Stays on the loopback address unless explicitly changed. */
  hostname?: string;
  /** Folder holding the built frontend. */
  staticDir?: string;
  /** Fallback re-read interval, for when the source's change stream is quiet or down. */
  pollMs?: number;
}

export interface OfficeServer {
  port: number;
  url: string;
  refresh(): Promise<void>;
  stop(): Promise<void>;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_MESSAGE = 4000;
const TOPIC = 'office';
const SCREEN_LINES_FOR_ANSWER = 60;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

function hostnameOf(value: string | null, isOrigin: boolean): string | null {
  if (!value) return null;
  try {
    return new URL(isOrigin ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

/**
 * The office is meant to be reached as localhost (directly or through an SSH
 * tunnel). Requests naming any other host are refused, so a web page elsewhere
 * cannot use the visitor's browser to read screens or message agents.
 */
function refuseNonLocal(req: Request): Response | null {
  const host = hostnameOf(req.headers.get('host'), false);
  if (!host || !LOCAL_HOSTS.has(host)) return json({ error: 'This server only answers as localhost.' }, 403);
  const origin = req.headers.get('origin');
  if (origin && !LOCAL_HOSTS.has(hostnameOf(origin, true) ?? '')) {
    return json({ error: 'Cross-site requests are refused.' }, 403);
  }
  return null;
}

/** Starts the office server. Throws if the port is taken. */
export function startServer(opts: ServerOptions): OfficeServer {
  const { source } = opts;
  const staticDir = opts.staticDir ? resolve(opts.staticDir) : null;
  let snapshot: OfficeSnapshot = emptySnapshot(source.name, 'Starting…');
  let lastSent = '';
  let running: Promise<void> | null = null;
  let again = false;

  const sessionOf = (agentId: string) => snapshot.agents.find((a) => a.id === agentId)?.session ?? null;

  const readOnce = async () => {
    try {
      snapshot = await source.snapshot();
    } catch (err) {
      // Keep showing the last known office, flagged as stale, rather than an empty room.
      snapshot = { ...snapshot, generatedAt: new Date().toISOString(), health: { ok: false, message: (err as Error).message } };
    }
    const comparable = JSON.stringify({ ...snapshot, generatedAt: '' });
    if (comparable !== lastSent) {
      lastSent = comparable;
      server.publish(TOPIC, JSON.stringify({ type: 'snapshot', snapshot }));
    }
  };

  /** One read at a time; a request arriving mid-read triggers exactly one more. */
  const refresh = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await readOnce();
      } while (again);
      running = null;
    })();
    return running;
  };

  const serveStatic = async (pathname: string): Promise<Response> => {
    if (!staticDir) return new Response('No frontend folder configured.', { status: 404 });
    const wanted = resolve(staticDir, `.${decodeURIComponent(pathname)}`);
    const inside = wanted === staticDir || wanted.startsWith(staticDir + sep);
    const file = inside && pathname !== '/' ? Bun.file(wanted) : null;
    if (file && (await file.exists())) return new Response(file);
    const index = Bun.file(resolve(staticDir, 'index.html'));
    if (await index.exists()) return new Response(index, { headers: { 'cache-control': 'no-cache' } });
    return new Response('The office frontend is not built yet. Run: bun run build', { status: 503 });
  };

  const server = Bun.serve({
    hostname: opts.hostname ?? '127.0.0.1',
    port: opts.port,
    async fetch(req, srv) {
      const refused = refuseNonLocal(req);
      if (refused) return refused;
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === '/ws') {
        return srv.upgrade(req) ? undefined : json({ error: 'Expected a WebSocket.' }, 400);
      }
      if (path === '/api/office' && req.method === 'GET') return json(snapshot);

      const agentRoute = path.match(/^\/api\/agents\/([^/]+)\/(screen|message|answer)$/);
      if (agentRoute) {
        const session = sessionOf(decodeURIComponent(agentRoute[1]!));
        if (!session) return json({ error: 'No such agent.' }, 404);
        try {
          if (agentRoute[2] === 'screen' && req.method === 'GET') {
            const lines = Math.min(Math.max(Number(url.searchParams.get('lines')) || 40, 1), 400);
            return json({ content: await source.readScreen(session, lines) });
          }
          if (agentRoute[2] === 'message' && req.method === 'POST') {
            if (!req.headers.get('content-type')?.startsWith('application/json')) {
              return json({ error: 'Send JSON.' }, 415);
            }
            const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
            const text = typeof body?.text === 'string' ? body.text.trim() : '';
            if (!text || text.length > MAX_MESSAGE) {
              return json({ error: `A message needs 1 to ${MAX_MESSAGE} characters.` }, 400);
            }
            await source.sendMessage(session, text);
            return json({ ok: true });
          }
          if (agentRoute[2] === 'answer' && req.method === 'POST') {
            if (!req.headers.get('content-type')?.startsWith('application/json')) {
              return json({ error: 'Send JSON.' }, 415);
            }
            const body = (await req.json().catch(() => null)) as { key?: unknown; label?: unknown } | null;
            const key = typeof body?.key === 'string' ? body.key : '';
            if (!/^[1-9]$/.test(key) || typeof body?.label !== 'string') {
              return json({ error: 'An answer needs the digit of a choice and its text.' }, 400);
            }
            // The key is only pressed if the question the person saw is still the one on screen.
            const now = parsePromptOptions(await source.readScreen(session, SCREEN_LINES_FOR_ANSWER));
            const option = now.find((o) => o.key === key);
            if (!option || option.label !== body.label) {
              return json({ error: 'That question is no longer on the screen. Nothing was pressed.' }, 409);
            }
            await source.answerPrompt(session, key);
            void refresh();
            return json({ ok: true });
          }
        } catch (err) {
          return json({ error: (err as Error).message }, 502);
        }
        return json({ error: 'Method not allowed.' }, 405);
      }
      if (path.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
      if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'Method not allowed.' }, 405);
      return serveStatic(path);
    },
    websocket: {
      open(ws) {
        ws.subscribe(TOPIC);
        ws.send(JSON.stringify({ type: 'snapshot', snapshot }));
      },
      message() {
        // The feed is one-way; writes go through the HTTP routes.
      },
    },
  });

  // A burst of change events becomes one re-read.
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = source.subscribe(() => {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      void refresh();
    }, 250);
  });
  const poll = setInterval(() => void refresh(), opts.pollMs ?? 5000);
  void refresh();

  return {
    port: server.port ?? opts.port,
    url: `http://${server.hostname}:${server.port}`,
    refresh,
    async stop() {
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      unsubscribe();
      await server.stop(true);
    },
  };
}
