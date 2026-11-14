import { describe, expect, test } from 'bun:test';
import { normalizeNode, normalizeQueue, normalizeRigs, OpenRigSource, parseEvent, statusOf } from '../src/index.ts';
import growth from './fixtures/nodes-growth.json';
import kernel from './fixtures/nodes-kernel.json';
import summary from './fixtures/summary.json';

// Fixtures are trimmed copies of real answers from OpenRig 0.7.13 (captured 2026-11-14).

describe('normalize', () => {
  test('real seats become agents with pod, session and a status', () => {
    const agents = [...growth, ...kernel].map((n) => normalizeNode(n));
    expect(agents.every((a) => a !== null)).toBe(true);
    expect(agents).toHaveLength(12);
    const byName = new Map(agents.map((a) => [a!.name, a!]));
    expect(byName.get('reach.writer')).toMatchObject({
      rig: 'growth', pod: 'reach', session: 'reach-writer@growth', kind: 'agent', runtime: 'claude-code', status: 'idle',
    });
    // Both fields say it is waiting; the reason comes from the newer, arbitrated one.
    expect(byName.get('build.demo')).toMatchObject({ status: 'needs-input', statusReason: 'permission_prompt' });
    expect(byName.get('operator.human')).toMatchObject({ kind: 'infrastructure', status: 'working' });
    // The newer field said idle while the terminal showed it thinking: either one is enough for "working".
    expect(byName.get('orch.lead')!.status).toBe('working');
    expect(byName.get('orch.lead')!.work).toEqual({ assigned: 3, pending: 0, inProgress: 0, blocked: 3 });
  });

  test('status rules', () => {
    expect(statusOf({}).status).toBe('unknown');
    expect(statusOf({ activityState: { display: 'idle', needsInput: { count: 2, reason: 'permission_prompt' } } }))
      .toEqual({ status: 'needs-input', reason: 'permission_prompt' });
    expect(statusOf({ agentActivity: { state: 'running', stale: true }, activityState: { display: 'idle' } }).status)
      .toBe('idle');
    expect(statusOf({ agentActivity: { state: 'needs_input', reason: 'usage_limit' } }))
      .toEqual({ status: 'needs-input', reason: 'usage_limit' });
  });

  test('nodes without an id or session are dropped, archived rigs are hidden', () => {
    expect(normalizeNode({ logicalId: 'x' })).toBeNull();
    expect(normalizeRigs(summary).map((r) => r.name)).toEqual(['growth', 'kernel']);
    expect(normalizeRigs([{ id: '1', name: 'old', archivedAt: '2026-01-01' }])).toEqual([]);
  });

  test('queue items keep a bounded summary', () => {
    const [item] = normalizeQueue([{ qitemId: 'q1', summary: 'x'.repeat(900), state: 'blocked', destinationSession: 'a@b' }]);
    expect(item).toMatchObject({ id: 'q1', state: 'blocked', to: 'a@b', from: '' });
    expect(item!.summary).toHaveLength(300);
  });

  test('event stream blocks are parsed', () => {
    expect(parseEvent('data: {"a":1}\nid: 7')).toEqual({ id: '7', data: '{"a":1}' });
    expect(parseEvent(': keep-alive')).toEqual({ id: null, data: null });
  });
});

describe('OpenRigSource', () => {
  const fake = (routes: Record<string, unknown>, seen: Request[] = []) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      seen.push(req);
      const path = new URL(req.url).pathname + new URL(req.url).search;
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      return key ? Response.json(routes[key]) : new Response('nope', { status: 404 });
    }) as typeof fetch;

  test('builds a snapshot from the daemon routes and survives a missing queue', async () => {
    const source = new OpenRigSource({
      baseUrl: 'http://rig.test/',
      fetch: fake({
        '/api/rigs/summary': summary,
        [`/api/rigs/${summary.find((r) => r.name === 'growth')!.id}/nodes`]: growth,
        [`/api/rigs/${summary.find((r) => r.name === 'kernel')!.id}/nodes`]: kernel,
      }),
    });
    const snap = await source.snapshot();
    expect(snap.agents).toHaveLength(12);
    expect(snap.rigs.map((r) => r.name)).toEqual(['growth', 'kernel']);
    expect(snap.queue).toEqual([]);
    expect(snap.health).toEqual({ ok: true, message: 'Task list unavailable' });
  });

  test('sends a message to the transport route and reports a refused delivery', async () => {
    const seen: Request[] = [];
    const ok = new OpenRigSource({ baseUrl: 'http://rig.test', fetch: fake({ '/api/transport/send': { ok: true } }, seen) });
    await ok.sendMessage('a@b', 'hello');
    expect(seen[0]!.method).toBe('POST');
    expect(await seen[0]!.json()).toEqual({ session: 'a@b', text: 'hello' });

    const held = new OpenRigSource({
      baseUrl: 'http://rig.test',
      fetch: fake({ '/api/transport/send': { ok: true, sent: false, reason: 'runtime_switch_in_progress' } }),
    });
    expect(held.sendMessage('a@b', 'hello')).rejects.toThrow('runtime_switch_in_progress');
  });

  test('an unreachable daemon is a clear error', async () => {
    const down = new OpenRigSource({
      baseUrl: 'http://rig.test',
      fetch: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch,
    });
    expect(down.snapshot()).rejects.toThrow('not reachable');
  });
});
