import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySettings, MockSource, type AgentSettings, type SettingsSaved } from '@backoffice/core';
import { startServer, type OfficeServer } from '../src/server.ts';
import { HarnessCatalog, opencodeLauncher, TeamFileSettings, type RigRunner } from '../src/settings.ts';

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
/** What the fake daemon says about community harness presets, and the folder it reads them from. */
let presets: Array<{ name: string; usable: boolean; problem?: string }>;
let presetDir: string;

const daemon: RigRunner = async (args) =>
  args[0] === 'community-harness'
    ? { ok: true, output: JSON.stringify({ dir: presetDir, harnesses: presets }) }
    : { ok: false, output: 'unexpected' };

const catalog = (env: Record<string, string> = { BACKOFFICE_HARNESSES: 'claude-code,codex,opencode' }) =>
  new HarnessCatalog({
    env,
    run: daemon,
    which: (p) => (p === 'claude' || p === 'opencode' ? `/usr/bin/${p}` : null),
    listModels: async () => ['opencode/big-pickle'],
    home: dir,
  });

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
  presets = [];
  presetDir = join(dir, 'openrig/community-harnesses');
  store = new TeamFileSettings({
    teamsDir: dir,
    harnesses: catalog(),
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
    const failing = new TeamFileSettings({ teamsDir: dir, harnesses: catalog(), run: async () => ({ ok: false, output: 'seat not found' }) });
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

describe('harness', () => {
  test('the file\'s harness and the offered ones are read', async () => {
    const s = await store.read(demo);
    expect(s.runtime).toBe('claude-code');
    expect(s.runtimes.map((h) => [h.id, h.liveSwitch])).toEqual([['claude-code', true], ['codex', true], ['opencode', false]]);
    expect(s.runtimes.find((h) => h.id === 'opencode')!.models).toEqual(['opencode/big-pickle']);
  });

  test('moving to a built-in harness rewrites one line and switches the running seat with the model', async () => {
    const saved = await store.write(demo, { runtime: 'codex', model: 'gpt-6' });
    expect(saved.settings.runtime).toBe('codex');
    const text = await rigText();
    expect(text).toContain('        runtime: codex\n        profile: default\n        cwd: "~/work" # shared folder');
    expect(text).toContain('        model: gpt-6');
    expect(calls).toEqual([
      ['seat', 'set-runtime', 'build-demo@growth', '--runtime', 'codex', '--reason', 'Set in OpenRig Space', '--model', 'gpt-6'],
    ]);
    expect(saved.settings.toolsEditable).toBe(false);
  });

  test('moving to opencode installs its preset once, writes the file and leaves the running seat alone', async () => {
    const daemonSeesIt: RigRunner = async (args) => {
      if (args[0] !== 'community-harness') return { ok: false, output: '' };
      const installed = await stat(join(presetDir, 'opencode.yaml')).then(() => true, () => false);
      return { ok: true, output: JSON.stringify({ dir: presetDir, harnesses: installed ? [{ name: 'opencode', usable: true }] : [] }) };
    };
    const harnesses = new HarnessCatalog({
      env: { BACKOFFICE_HARNESSES: 'claude-code,opencode' }, run: daemonSeesIt, which: (p) => (p === 'opencode' ? '/usr/bin/opencode' : null), home: dir,
    });
    const local = new TeamFileSettings({ teamsDir: dir, harnesses, run: async (args) => (calls.push(args), { ok: true, output: '' }) });
    const saved = await local.write(demo, { runtime: 'opencode', model: 'opencode/big-pickle' });
    expect(saved.settings.runtime).toBe('opencode');
    expect(await rigText()).toContain('        model: opencode/big-pickle');
    expect(calls).toEqual([]);
    const preset = await readFile(join(presetDir, 'opencode.yaml'), 'utf8');
    expect(preset).toContain('format: 1\nname: opencode\n');
    expect(preset).toContain('passes_model: true');
    expect(((await stat(join(presetDir, 'opencode-launch.sh'))).mode & 0o777).toString(8)).toBe('755');
    expect(saved.notes.join(' ')).toContain('Installed opencode for OpenRig');
    expect(saved.notes.join(' ')).toContain('rig up');

    // Second time round the preset is there, so nothing is written again.
    await writeFile(join(presetDir, 'opencode.yaml'), '# mine\n');
    const other = { ...demo, name: 'orch.lead', session: 'orch-lead@growth', pod: 'orch' };
    const again = await local.write(other, { runtime: 'opencode' });
    expect(again.notes.join(' ')).not.toContain('Installed');
    expect(await readFile(join(presetDir, 'opencode.yaml'), 'utf8')).toBe('# mine\n');
  });

  test('a preset OpenRig refuses is removed and nothing else is written', async () => {
    let wrote = false;
    const refusing: RigRunner = async () => {
      const harnesses = wrote ? [{ name: 'opencode', usable: false, problem: 'bad command' }] : [];
      wrote = true;
      return { ok: true, output: JSON.stringify({ dir: presetDir, harnesses }) };
    };
    const harnesses = new HarnessCatalog({ env: { BACKOFFICE_HARNESSES: 'opencode' }, run: refusing, which: () => '/usr/bin/opencode', home: dir });
    const local = new TeamFileSettings({ teamsDir: dir, harnesses, run: async () => ({ ok: true, output: '' }) });
    await expect(local.write(demo, { runtime: 'opencode' })).rejects.toThrow('bad command');
    expect(await rigText()).toBe(RIG);
    expect(await stat(join(presetDir, 'opencode.yaml')).then(() => true, () => false)).toBe(false);
  });

  test('a harness that is not offered is refused', async () => {
    await expect(store.write(demo, { runtime: 'pi' })).rejects.toThrow('not a harness this office offers');
    expect(await rigText()).toBe(RIG);
  });

  test('a quick switch reports the move', async () => {
    const saved = await store.write(demo, { runtime: 'codex' });
    expect(saved.notes.join(' ')).toContain('moved to codex');
  });

  test('without BACKOFFICE_HARNESSES, installed built-ins, usable presets and opencode are offered', async () => {
    presets = [{ name: 'goose', usable: true }, { name: 'broken', usable: false, problem: 'x' }];
    const offered = await catalog({ BACKOFFICE_MODELS_GOOSE: 'a/b, c/d' }).list();
    expect(offered.map((h) => h.id)).toEqual(['claude-code', 'goose', 'opencode']);
    expect(offered.find((h) => h.id === 'goose')!.models).toEqual(['a/b', 'c/d']);
    expect(offered.find((h) => h.id === 'claude-code')!.models).toContain('opus');
  });

  test('the opencode launcher hands the seat model over as inline config', async () => {
    const script = join(dir, 'launch.sh');
    await writeFile(script, opencodeLauncher('/usr/bin/env'), { mode: 0o755 });
    const run = (model: string) =>
      Bun.spawnSync([script], { env: { PATH: process.env.PATH!, OPENRIG_MODEL: model } }).stdout.toString();
    const line = (out: string) => out.split('\n').find((l) => l.startsWith('OPENCODE_CONFIG_CONTENT='));
    expect(line(run('opencode/big-pickle'))).toBe('OPENCODE_CONFIG_CONTENT={"model":"opencode/big-pickle"}');
    expect(JSON.parse(line(run('we"ird\\id'))!.slice(24))).toEqual({ model: 'we"ird\\id' });
    expect(line(Bun.spawnSync([script], { env: { PATH: process.env.PATH! } }).stdout.toString())).toBeUndefined();
  });
});

describe('working folder', () => {
  const lead = { ...demo, name: 'orch.lead', session: 'orch-lead@growth', pod: 'orch' };
  const site = { ...demo, name: 'build.site', session: 'build-site@growth', runtime: 'codex' };

  test('is read with how many members share it', async () => {
    const s = await store.read(demo);
    expect(s.cwd).toBe('~/work');
    expect(s.cwdSharedBy).toBe(1);
    expect((await store.read(lead)).cwdSharedBy).toBe(2);
  });

  test('for one agent: one line changes, the comment stays, and the seat is told the full path', async () => {
    const local = new TeamFileSettings({ teamsDir: dir, harnesses: catalog(), home: '/home/me', run: async (a) => (calls.push(a), { ok: true, output: '' }) });
    const saved = await local.write(demo, { cwd: '~/projects/demo' });
    expect(saved.settings.cwd).toBe('~/projects/demo');
    expect(await rigText()).toContain('        cwd: "~/projects/demo" # shared folder');
    expect(calls).toEqual([['seat', 'set-cwd', 'build-demo@growth', '--cwd', '/home/me/projects/demo', '--reason', 'Set in OpenRig Space']]);
    expect(saved.notes.join(' ')).toContain('are not moved');
  });

  test('for the rig: everyone sharing the folder moves, members with their own folder stay', async () => {
    // lead and site have no cwd line, so they share "no folder"; demo has its own.
    const saved = await store.write(lead, { cwd: '/srv/growth', cwdScope: 'rig' });
    const text = await rigText();
    expect(text.match(/cwd: "\/srv\/growth"/g)).toHaveLength(2);
    expect(text).toContain('cwd: "~/work" # shared folder');
    expect(calls.map((c) => c[2])).toEqual(['orch-lead@growth', 'build-site@growth']);
    expect(saved.notes.join(' ')).toContain('2 agents of growth');
    expect((await store.read(site)).cwd).toBe('/srv/growth');
  });

  test('a seat that refuses the folder is named', async () => {
    const failing = new TeamFileSettings({ teamsDir: dir, harnesses: catalog(), run: async () => ({ ok: false, output: 'preflight refused' }) });
    const saved = await failing.write(demo, { cwd: '/srv/x' });
    expect(saved.notes.join(' ')).toContain('build-demo@growth: preflight refused');
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
    const moved = (await (await put({ runtime: 'opencode', model: 'opencode/big-pickle' })).json()) as SettingsSaved;
    expect(moved.settings.runtime).toBe('opencode');
    expect(moved.settings.toolsEditable).toBe(false);
  });

  test('refuses what it should', async () => {
    expect((await put({ model: 'opus' }, 'text/plain')).status).toBe(415);
    expect((await put({ model: 'rm -rf /' })).status).toBe(400);
    expect((await put({ allow: 'WebSearch' })).status).toBe(400);
    expect((await put({ skills: ['made-up'] })).status).toBe(400);
    expect((await put([])).status).toBe(400);
    expect((await put({ runtime: 'rm -rf' })).status).toBe(400);
    expect((await put({ runtime: 'goose' })).status).toBe(400);
    expect((await put({ cwd: 'relative/path' })).status).toBe(400);
    expect((await put({ cwd: '/srv/../etc' })).status).toBe(400);
    expect((await put({ cwd: '/srv/x', cwdScope: 'team' })).status).toBe(400);
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
