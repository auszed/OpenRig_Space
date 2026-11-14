import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySettings, MockSource, type AgentSettings, type SettingsSaved } from '@backoffice/core';
import { startServer, type OfficeServer } from '../src/server.ts';
import { TeamFileSettings } from '../src/settings.ts';

const RIG = `version: "0.2"
name: growth
# The team that sells.
pods:
  - id: orch
    members:
      - id: lead
        agent_ref: "local:../agents/orchestrator"
        runtime: claude-code
        profile: default
  - id: build
    label: Website and demos
    members:
      - id: site
        agent_ref: "local:../agents/demo"
        runtime: codex
      - id: demo
        agent_ref: "local:../agents/demo"
        runtime: claude-code
        profile: default
        cwd: "~/work" # shared folder
        claude_permissions:
          allow: [WebSearch, WebFetch]
edges: []
`;

const AGENT = `name: demo
imports:
  - ref: local:../shared
profiles:
  default:
    uses:
      skills: [systematic-debugging]
      plugins: [shared:openrig-core]
resources:
  skills:
    - id: own-skill
      path: skills/own
`;

const SHARED = `name: shared
resources:
  skills:
    - id: systematic-debugging
      path: skills/a
    # PM skills
    - id: office-hours
      path: skills/b
`;

const demo = { name: 'build.demo', session: 'build-demo@growth', rig: 'growth', pod: 'build', runtime: 'claude-code' };

let dir: string;
let calls: string[][];
let rules: unknown;
let store: TeamFileSettings;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'teams-'));
  for (const [path, text] of [
    ['growth/rig.yaml', RIG],
    ['agents/demo/agent.yaml', AGENT],
    ['agents/shared/agent.yaml', SHARED],
  ] as const) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  calls = [];
  rules = null;
  store = new TeamFileSettings({
    teamsDir: dir,
    run: async (args) => {
      calls.push(args);
      const at = args.indexOf('--rules');
      if (at >= 0) rules = JSON.parse(await readFile(args[at + 1]!, 'utf8'));
      return { ok: true, output: '' };
    },
  });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const rigText = () => readFile(join(dir, 'growth/rig.yaml'), 'utf8');

describe('agent settings in team files', () => {
  test('reads model, skills and tool rules for one member', async () => {
    const s = await store.read(demo);
    expect(s.editable).toBe(true);
    expect(s.model).toBeNull();
    expect(s.skills).toEqual(['systematic-debugging']);
    expect(s.availableSkills).toEqual(['office-hours', 'own-skill', 'systematic-debugging']);
    expect(s.allow).toEqual(['WebSearch', 'WebFetch']);
    expect(s.files).toHaveLength(2);
  });

  test('setting a model adds one line and tells the seat', async () => {
    const saved = await store.write(demo, { model: 'opus' });
    expect(saved.settings.model).toBe('opus');
    const text = await rigText();
    const added = text.split('\n').filter((l) => !RIG.split('\n').includes(l));
    expect(added).toEqual(['        model: opus']);
    expect(text).toContain('# The team that sells.');
    expect(text).toContain('# shared folder');
    expect(await readFile(join(dir, 'growth/rig.yaml.bak'), 'utf8')).toBe(RIG);
    expect(calls).toEqual([['seat', 'set-model', 'build-demo@growth', '--model', 'opus', '--reason', 'Set in OpenRig Space']]);
  });

  test('changing a model that has a comment after it keeps the comment', async () => {
    const path = join(dir, 'growth/rig.yaml');
    await writeFile(path, RIG.replace('        runtime: codex', '        runtime: codex\n        model: gpt-5 # fast one'));
    const site = { ...demo, name: 'build.site', session: 'build-site@growth', runtime: 'codex' };
    await store.write(site, { model: 'gpt-6' });
    expect(await rigText()).toContain('        model: gpt-6 # fast one\n      - id: demo');
  });

  test('clearing the model removes the line and leaves the seat alone', async () => {
    await store.write(demo, { model: 'opus' });
    calls = [];
    const saved = await store.write(demo, { model: null });
    expect(saved.settings.model).toBeNull();
    expect(await rigText()).toBe(RIG);
    expect(calls).toEqual([]);
  });

  test('tool rules are written on one line and handed to the seat as a file', async () => {
    const saved = await store.write(demo, { allow: ['WebSearch'], deny: ['Bash(rm *)'] });
    expect(saved.settings.allow).toEqual(['WebSearch']);
    expect(saved.settings.deny).toEqual(['Bash(rm *)']);
    const text = await rigText();
    expect(text).toContain('          allow: [WebSearch]');
    expect(text).toContain('          deny: ["Bash(rm *)"]');
    expect(rules).toEqual({ allow: ['WebSearch'], deny: ['Bash(rm *)'] });
    expect(calls[0]!.slice(0, 3)).toEqual(['seat', 'set-permissions', 'build-demo@growth']);
  });

  test('removing every rule removes the block', async () => {
    await store.write(demo, { allow: [] });
    expect(await rigText()).not.toContain('claude_permissions');
    expect(rules).toEqual({ allow: [], deny: [] });
  });

  test('skills go to the agent file, and only known ones', async () => {
    const saved = await store.write(demo, { skills: ['office-hours', 'own-skill'] });
    expect(saved.settings.skills).toEqual(['office-hours', 'own-skill']);
    expect(await rigText()).toBe(RIG);
    expect(calls).toEqual([]);
    expect(saved.notes.join(' ')).toContain('2 agents of this rig');
    expect(await readFile(join(dir, 'agents/demo/agent.yaml'), 'utf8')).toContain('plugins: [shared:openrig-core]');
    await expect(store.write(demo, { skills: ['made-up'] })).rejects.toThrow('no skill called "made-up"');
  });

  test('saving the same values writes nothing', async () => {
    const saved = await store.write(demo, { model: null, allow: ['WebSearch', 'WebFetch'], skills: ['systematic-debugging'] });
    expect(saved.notes).toEqual(['Nothing changed.']);
    expect(calls).toEqual([]);
    expect(await rigText()).toBe(RIG);
  });

  test('a seat that refuses the model is reported, the file still changes', async () => {
    const failing = new TeamFileSettings({ teamsDir: dir, run: async () => ({ ok: false, output: 'seat not found' }) });
    const saved = await failing.write(demo, { model: 'sonnet' });
    expect(saved.settings.model).toBe('sonnet');
    expect(saved.notes.join(' ')).toContain('seat not found');
  });

  test('tool rules are refused for a runtime that has none', async () => {
    const site = { ...demo, name: 'build.site', session: 'build-site@growth', runtime: 'codex' };
    expect((await store.read(site)).toolsEditable).toBe(false);
    await expect(store.write(site, { allow: ['WebSearch'] })).rejects.toThrow('cannot be set');
  });

  test('a rig without team files, or an unknown member, is read-only', async () => {
    const kernel = await store.read({ ...demo, rig: 'kernel' });
    expect(kernel.editable).toBe(false);
    expect(kernel.reason).toContain('not defined by team files');
    expect((await store.read({ ...demo, name: 'build.ghost' })).editable).toBe(false);
    expect((await store.read({ ...demo, rig: '../growth' })).editable).toBe(false);
    await expect(store.write({ ...demo, rig: 'kernel' }, { model: 'opus' })).rejects.toThrow();
  });
});

describe('settings routes', () => {
  let server: OfficeServer;
  let base: string;
  beforeEach(async () => {
    server = startServer({ source: new MockSource(), settings: new MemorySettings(), port: 0, pollMs: 60_000 });
    await server.refresh();
    base = `http://127.0.0.1:${server.port}/api/agents/mock-2/settings`;
  });
  afterEach(() => server.stop());

  const put = (body: unknown, type = 'application/json') =>
    fetch(base, { method: 'PUT', headers: { 'content-type': type }, body: JSON.stringify(body) });

  test('reads and saves', async () => {
    const before = (await (await fetch(base)).json()) as AgentSettings;
    expect(before.editable).toBe(true);
    const res = await put({ model: 'opus', allow: ['WebSearch', ' WebSearch '] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as SettingsSaved).settings.allow).toEqual(['WebSearch']);
    expect(((await (await fetch(base)).json()) as AgentSettings).model).toBe('opus');
  });

  test('refuses what it should', async () => {
    expect((await put({ model: 'opus' }, 'text/plain')).status).toBe(415);
    expect((await put({ model: 'rm -rf /' })).status).toBe(400);
    expect((await put({ allow: 'WebSearch' })).status).toBe(400);
    expect((await put({ skills: ['made-up'] })).status).toBe(400);
    expect((await put([])).status).toBe(400);
    expect((await fetch(base.replace('mock-2', 'nobody'))).status).toBe(404);
    expect((await fetch(base, { method: 'DELETE' })).status).toBe(405);
  });

  test('answers 404 when the server has no settings store', async () => {
    const bare = startServer({ source: new MockSource(), port: 0, pollMs: 60_000 });
    await bare.refresh();
    expect((await fetch(`http://127.0.0.1:${bare.port}/api/agents/mock-2/settings`)).status).toBe(404);
    await bare.stop();
  });
});
