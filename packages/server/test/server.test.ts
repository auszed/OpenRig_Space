import { afterEach, describe, expect, test } from 'bun:test';
import { MockSource, type OfficeSnapshot } from '@backoffice/core';
import { startServer, type OfficeServer } from '../src/server.ts';

let servers: OfficeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop()));
  servers = [];
});

async function boot(source = new MockSource()) {
  const server = startServer({ source, port: 0, pollMs: 60_000 });
  servers.push(server);
  await server.refresh();
  return { server, source, base: `http://127.0.0.1:${server.port}` };
}

describe('office server', () => {
  test('serves the snapshot', async () => {
    const { base } = await boot();
    const snap = (await (await fetch(`${base}/api/office`)).json()) as OfficeSnapshot;
    expect(snap.source).toBe('mock');
    expect(snap.agents).toHaveLength(8);
    expect(snap.health.ok).toBe(true);
  });

  test('pushes a new snapshot over the WebSocket when an agent changes', async () => {
    const { base, source } = await boot();
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    const messages: OfficeSnapshot[] = [];
    const gotTwo = new Promise<void>((done, fail) => {
      ws.onmessage = (e) => {
        messages.push(JSON.parse(String(e.data)).snapshot);
        if (messages.length === 1) source.setStatus('mock-4', 'needs-input', 'permission_prompt');
        if (messages.length === 2) done();
      };
      setTimeout(() => fail(new Error('no update within 3s')), 3000);
    });
    await gotTwo;
    ws.close();
    expect(messages[0]!.agents.find((a) => a.id === 'mock-4')!.status).toBe('idle');
    expect(messages[1]!.agents.find((a) => a.id === 'mock-4')).toMatchObject({
      status: 'needs-input', statusReason: 'permission_prompt',
    });
  });

  test('reads a screen and delivers a message to the right session', async () => {
    const { base, source } = await boot();
    const screen = (await (await fetch(`${base}/api/agents/mock-2/screen?lines=5`)).json()) as { content: string };
    expect(screen.content).toContain('build-api@demo');

    const sent = await fetch(`${base}/api/agents/mock-2/message`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '  status?  ' }),
    });
    expect(sent.status).toBe(200);
    expect(source.sent).toEqual([{ session: 'build-api@demo', text: 'status?' }]);
  });

  test('refuses bad messages, unknown agents and other sites', async () => {
    const { base, source } = await boot();
    const post = (path: string, init: RequestInit) => fetch(base + path, { method: 'POST', ...init });
    const jsonHeaders = { 'content-type': 'application/json' };

    expect((await post('/api/agents/mock-2/message', { headers: jsonHeaders, body: '{"text":""}' })).status).toBe(400);
    expect((await post('/api/agents/mock-2/message', { headers: jsonHeaders, body: JSON.stringify({ text: 'x'.repeat(4001) }) })).status).toBe(400);
    expect((await post('/api/agents/mock-2/message', { body: 'text=hi' })).status).toBe(415);
    expect((await post('/api/agents/nobody/message', { headers: jsonHeaders, body: '{"text":"hi"}' })).status).toBe(404);
    expect((await post('/api/agents/mock-2/message', {
      headers: { ...jsonHeaders, origin: 'https://evil.example' }, body: '{"text":"hi"}',
    })).status).toBe(403);
    expect((await fetch(`${base}/api/office`, { headers: { host: 'evil.example' } })).status).toBe(403);
    expect(source.sent).toEqual([]);
  });

  test('answers a prompt only when that exact choice is still on the screen', async () => {
    const { base, source } = await boot();
    const answer = (id: string, body: unknown) =>
      fetch(`${base}/api/agents/${id}/answer`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });

    // mock-3 is stopped at "1. Yes / 2. Yes, and don't ask again / 3. No".
    expect((await answer('mock-3', { key: '3', label: 'Yes' })).status).toBe(409); // text does not match
    expect((await answer('mock-3', { key: '7', label: 'No' })).status).toBe(409); // no such choice
    expect((await answer('mock-3', { key: 'y', label: 'Yes' })).status).toBe(400);
    expect((await answer('mock-3', { key: '1' })).status).toBe(400);
    expect((await answer('mock-2', { key: '1', label: 'Yes' })).status).toBe(409); // not at a prompt
    expect(source.answered).toEqual([]);

    expect((await answer('mock-3', { key: '3', label: 'No' })).status).toBe(200);
    expect(source.answered).toEqual([{ session: 'build-web@demo', key: '3' }]);
    // The question is gone now, so pressing again does nothing.
    expect((await answer('mock-3', { key: '3', label: 'No' })).status).toBe(409);
    expect(source.answered).toHaveLength(1);
  });

  test('keeps the last office and flags it when the source fails', async () => {
    const source = new MockSource();
    const { base, server } = await boot(source);
    source.snapshot = async () => { throw new Error('daemon gone'); };
    await server.refresh();
    const snap = (await (await fetch(`${base}/api/office`)).json()) as OfficeSnapshot;
    expect(snap.agents).toHaveLength(8);
    expect(snap.health).toEqual({ ok: false, message: 'daemon gone' });
  });

  test('refuses to start on a port that is taken', async () => {
    const { server } = await boot();
    expect(() => startServer({ source: new MockSource(), port: server.port })).toThrow();
  });

  test('says so when the frontend is not built', async () => {
    const server = startServer({ source: new MockSource(), port: 0, staticDir: '/nonexistent-backoffice-dist' });
    servers.push(server);
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('bun run build');
  });
});
