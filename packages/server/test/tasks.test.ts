import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { cleanTask, columnOf, isOpenTask, MockSource, rigOfSession, type OfficeSnapshot } from '@backoffice/core';
import { startServer, type OfficeServer } from '../src/server.ts';
import type { RigRunner } from '../src/settings.ts';
import { openrigWorkspace, RigQueueTasks } from '../src/tasks.ts';

let servers: OfficeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop()));
  servers = [];
});

async function boot() {
  const source = new MockSource();
  const server = startServer({ source, tasks: source, port: 0, pollMs: 60_000, workspace: async () => ({ root: '/ws' }) });
  servers.push(server);
  await server.refresh();
  const base = `http://127.0.0.1:${server.port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const office = async () => (await (await fetch(`${base}/api/office`)).json()) as OfficeSnapshot;
  return { base, post, office, server };
}

describe('task helpers', () => {
  test('tasks are checked before they go anywhere', () => {
    expect(cleanTask({ destination: 'dev-build@duo', summary: ' Review it ', body: '' }))
      .toEqual({ destination: 'dev-build@duo', summary: 'Review it', body: 'Review it', priority: 'routine' });
    expect(() => cleanTask({ destination: 'nobody', summary: 'x' })).toThrow('Pick the agent');
    expect(() => cleanTask({ destination: 'a@b', summary: 'two\nlines' })).toThrow('one line');
    expect(() => cleanTask({ destination: 'a@b', summary: 'x', priority: 'asap' })).toThrow('Priority');
  });

  test('queue states map to board columns, and rigs come from sessions', () => {
    expect(['pending', 'in-progress', 'blocked', 'done'].map(columnOf)).toEqual(['todo', 'doing', 'blocked', 'done']);
    expect(isOpenTask('in-progress')).toBe(true);
    expect(isOpenTask('done')).toBe(false);
    expect(rigOfSession('dev-build@duo')).toBe('duo');
    expect(rigOfSession('hanns@external')).toBe('external');
    expect(rigOfSession('nope')).toBeNull();
  });
});

describe('rig queue tasks', () => {
  const recorder = (answers: Record<string, string> = {}) => {
    const calls: string[][] = [];
    let body = '';
    const run: RigRunner = async (args) => {
      calls.push(args);
      const file = args.indexOf('--body-file');
      if (file >= 0) body = await readFile(args[file + 1]!, 'utf8');
      const key = args.slice(0, 2).join(' ');
      return { ok: true, output: answers[key] ?? '{}' };
    };
    return { calls, run, body: () => body };
  };

  test('a task becomes a queue row from the default person, with the body in a file', async () => {
    const r = recorder({
      'gateway participants': JSON.stringify({ participants: [{ id: 'hanns', address: 'hanns@external', default: true }] }),
      'queue create': JSON.stringify({ qitemId: 'qitem-123' }),
    });
    const tasks = new RigQueueTasks({ run: r.run });
    const made = await tasks.create({ destination: 'dev-build@duo', summary: 'Review the diff', body: 'Line one\n`and code`', priority: 'urgent' });
    expect(made.id).toBe('qitem-123');
    expect(r.body()).toBe('Line one\n`and code`');
    const create = r.calls.find((c) => c[1] === 'create')!;
    expect(create).toEqual([
      'queue', 'create', '--source', 'hanns@external', '--destination', 'dev-build@duo', '--summary', 'Review the diff',
      '--body-file', create[9]!, '--priority', 'urgent', '--tags', 'from:openrig-space', '--json',
    ]);
  });

  test('cancelling closes the row as canceled, with the reason', async () => {
    const r = recorder();
    await new RigQueueTasks({ run: r.run, person: 'hanns@external' }).cancel('qitem-9', 'not needed');
    expect(r.calls).toEqual([[
      'queue', 'update', 'qitem-9', '--state', 'done', '--closure-reason', 'canceled',
      '--note', 'Canceled in OpenRig Space: not needed', '--source', 'hanns@external',
    ]]);
  });

  test('without a person, or when OpenRig refuses, the error says what to do', async () => {
    const none = new RigQueueTasks({ run: async () => ({ ok: true, output: '{"participants":[]}' }) });
    await expect(none.create({ destination: 'a@b', summary: 'x', body: 'x', priority: 'routine' })).rejects.toThrow('BACKOFFICE_PERSON');
    const refusing = new RigQueueTasks({ person: 'hanns@external', run: async () => ({ ok: false, output: 'not the owner' }) });
    await expect(refusing.cancel('q1', null)).rejects.toThrow('not the owner');
    expect(() => new RigQueueTasks({ person: 'hanns' })).toThrow('name@external');
  });

  test('the workspace folders come from rig config', async () => {
    const run: RigRunner = async () => ({ ok: true, output: JSON.stringify({ workspace: { root: '/home/x/.openrig/workspace', slicesRoot: '/s', empty: '' } }) });
    expect(await openrigWorkspace(run)).toEqual({ root: '/home/x/.openrig/workspace', slicesRoot: '/s' });
    expect(await openrigWorkspace(async () => ({ ok: false, output: '' }))).toBeNull();
  });
});

describe('task routes', () => {
  test('a new task lands in the queue for its seat and rig', async () => {
    const { post, office } = await boot();
    const res = await post('/api/tasks', { destination: 'build-api@demo', summary: 'Add a health endpoint', priority: 'urgent' });
    expect(res.status).toBe(200);
    const row = (await office()).queue.find((q) => q.summary === 'Add a health endpoint')!;
    expect(row).toMatchObject({ state: 'pending', to: 'build-api@demo', rig: 'demo', priority: 'urgent' });
  });

  test('an open task can be cancelled once; finished and unknown ones cannot', async () => {
    const { post, office } = await boot();
    expect((await post('/api/tasks/mock-q2/cancel', { reason: 'dupe' })).status).toBe(200);
    expect((await office()).queue.find((q) => q.id === 'mock-q2')!.state).toBe('done');
    expect((await post('/api/tasks/mock-q2/cancel', {})).status).toBe(409);
    expect((await post('/api/tasks/nope/cancel', {})).status).toBe(404);
  });

  test('refuses what it should', async () => {
    const { post, base } = await boot();
    expect((await post('/api/tasks', { destination: 'ghost@demo', summary: 'x' })).status).toBe(404);
    expect((await post('/api/tasks', { destination: 'build-api@demo', summary: '' })).status).toBe(400);
    expect((await fetch(`${base}/api/tasks`)).status).toBe(405);
    const plain = await fetch(`${base}/api/tasks`, { method: 'POST', body: '{}' });
    expect(plain.status).toBe(415);
    const bare = startServer({ source: new MockSource(), port: 0, pollMs: 60_000 });
    servers.push(bare);
    expect((await fetch(`http://127.0.0.1:${bare.port}/api/tasks`, { method: 'POST' })).status).toBe(404);
  });

  test('serves the OpenRig workspace folders', async () => {
    const { base } = await boot();
    expect(await (await fetch(`${base}/api/openrig/workspace`)).json()).toEqual({ workspace: { root: '/ws' } });
  });
});
