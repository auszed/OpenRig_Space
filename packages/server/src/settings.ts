import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isMap, isScalar, LineCounter, parseDocument, type Document, type YAMLMap } from 'yaml';
import {
  LIVE_SWITCH_RUNTIMES, MODEL_CHOICES, SettingsError,
  type AgentSettings, type HarnessChoice, type SettingsAgent, type SettingsPatch, type SettingsSaved, type SettingsStore,
} from '@backoffice/core';

/** Runs the `rig` command line with these arguments. */
export type RigRunner = (args: string[]) => Promise<{ ok: boolean; output: string }>;

export interface TeamFileOptions {
  /** Folder holding one sub-folder per rig, each with a `rig.yaml`. */
  teamsDir?: string;
  /** Replaced in tests; by default the `rig` on the PATH is run. */
  run?: RigRunner;
  /** Which harnesses are offered; by default built from the environment and what is installed. */
  harnesses?: HarnessCatalog;
}

const REASON = 'Set in OpenRig Space';
/** How long a harness switch is waited for before the answer goes back; it keeps going after that. */
const SWITCH_WAIT_MS = 20_000;

/** The result, or 'pending' if it takes longer than `ms`. The work itself is not stopped. */
async function settleWithin<T>(work: Promise<T>, ms: number): Promise<T | 'pending'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'pending'>((done) => (timer = setTimeout(() => done('pending'), ms)));
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** `~/openrig/teams` where everything OpenRig lives under `~/openrig`, else the older `~/openrig-teams`. */
export function defaultTeamsDir(home = homedir()): string {
  const current = join(home, 'openrig', 'teams');
  return existsSync(current) ? current : join(home, 'openrig-teams');
}
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const runRig: RigRunner = async (args) => {
  try {
    const proc = Bun.spawn(['rig', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { ok: code === 0, output: (code === 0 ? out : err || out).trim() };
  } catch (err) {
    return { ok: false, output: (err as Error).message };
  }
};

/** A preset as the OpenRig daemon reports it. */
interface PresetInfo {
  name: string;
  usable: boolean;
  problem: string | null;
}

export interface HarnessCatalogOptions {
  /** Read for BACKOFFICE_HARNESSES, BACKOFFICE_MODELS_<HARNESS> and OPENRIG_HOME. */
  env?: Record<string, string | undefined>;
  run?: RigRunner;
  /** Where a program is on this machine, or null. */
  which?: (program: string) => string | null;
  /** The models a harness lists itself (only opencode does). */
  listModels?: (harness: string, program: string) => Promise<string[]>;
  home?: string;
}

const PROGRAM: Record<string, string> = { 'claude-code': 'claude', codex: 'codex', pi: 'pi', opencode: 'opencode' };
const CACHE_MS = 60_000;

const whichProgram = (program: string): string | null => Bun.which(program);

async function opencodeModels(_harness: string, program: string): Promise<string[]> {
  try {
    const proc = Bun.spawn([program, 'models'], { stdout: 'pipe', stderr: 'ignore' });
    const timer = setTimeout(() => proc.kill(), 15_000);
    const out = await new Response(proc.stdout).text();
    clearTimeout(timer);
    return out.split('\n').map((l) => l.trim()).filter((l) => /^[\w.-]+\/\S+$/.test(l)).slice(0, 200);
  } catch {
    return [];
  }
}

const list = (value: string | undefined) => [...new Set((value ?? '').split(',').map((v) => v.trim()).filter(Boolean))];

/**
 * The harnesses agents may run on. `BACKOFFICE_HARNESSES` names them outright;
 * without it, every built-in harness whose program is installed is offered,
 * plus each community harness OpenRig has a preset for, plus opencode when it
 * is installed (this office can write its preset). Suggested models come from
 * `BACKOFFICE_MODELS_<HARNESS>` (e.g. BACKOFFICE_MODELS_OPENCODE), else from
 * the harness itself where it can say.
 */
export class HarnessCatalog {
  private env: Record<string, string | undefined>;
  private run: RigRunner;
  private which: (program: string) => string | null;
  private listModels: (harness: string, program: string) => Promise<string[]>;
  private home: string;
  private cached: { at: number; value: Promise<HarnessChoice[]> } | null = null;

  constructor(opts: HarnessCatalogOptions = {}) {
    this.env = opts.env ?? process.env;
    this.run = opts.run ?? runRig;
    this.which = opts.which ?? whichProgram;
    this.listModels = opts.listModels ?? opencodeModels;
    this.home = opts.home ?? homedir();
  }

  /** The opencode program: on the PATH, else where its installer puts it. */
  opencodeProgram(): string | null {
    const found = this.which('opencode');
    if (found) return found;
    const usual = join(this.home, '.opencode', 'bin', 'opencode');
    return existsSync(usual) ? usual : null;
  }

  private program(id: string): string | null {
    return id === 'opencode' ? this.opencodeProgram() : PROGRAM[id] ? this.which(PROGRAM[id]!) : null;
  }

  /** What the daemon knows about community harness presets, or null when it cannot be asked. */
  async presets(): Promise<{ dir: string | null; harnesses: PresetInfo[] } | null> {
    const done = await this.run(['community-harness', 'list', '--json']);
    if (!done.ok) return null;
    try {
      const data = JSON.parse(done.output) as { dir?: unknown; harnesses?: Array<Record<string, unknown>> };
      return {
        dir: typeof data.dir === 'string' ? data.dir : null,
        harnesses: (data.harnesses ?? []).map((h) => ({
          name: String(h.name ?? ''),
          usable: h.usable !== false,
          problem: typeof h.problem === 'string' ? h.problem : null,
        })),
      };
    } catch {
      return null;
    }
  }

  list(): Promise<HarnessChoice[]> {
    if (!this.cached || Date.now() - this.cached.at > CACHE_MS) {
      this.cached = { at: Date.now(), value: this.build() };
    }
    return this.cached.value;
  }

  forget(): void {
    this.cached = null;
  }

  private async build(): Promise<HarnessChoice[]> {
    let ids = list(this.env.BACKOFFICE_HARNESSES);
    if (ids.length === 0) {
      const presets = await this.presets();
      ids = [
        ...LIVE_SWITCH_RUNTIMES.filter((id) => this.program(id)),
        ...(presets?.harnesses.filter((h) => h.usable).map((h) => h.name) ?? []),
        ...(this.opencodeProgram() ? ['opencode'] : []),
      ];
    }
    return Promise.all(
      [...new Set(ids)].map(async (id): Promise<HarnessChoice> => {
        const named = list(this.env[`BACKOFFICE_MODELS_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`]);
        const program = this.program(id);
        const models = named.length
          ? named
          : id === 'claude-code'
            ? [...MODEL_CHOICES]
            : id === 'opencode' && program
              ? await this.listModels(id, program)
              : [];
        return { id, liveSwitch: LIVE_SWITCH_RUNTIMES.includes(id), models };
      }),
    );
  }

  /**
   * Makes sure OpenRig can launch opencode: writes a preset and its launcher
   * into OpenRig's community-harnesses folder when there is none, then has the
   * daemon read it back. An existing preset is never touched. Returns notes.
   */
  async ensureOpencode(): Promise<string[]> {
    const before = await this.presets();
    const known = before?.harnesses.find((h) => h.name === 'opencode');
    if (known?.usable) return [];
    if (known) throw new SettingsError(`OpenRig has an opencode preset it cannot use: ${known.problem ?? 'no reason given'}`, 409);

    const program = this.opencodeProgram();
    if (!program) throw new SettingsError('opencode is not installed on this machine, so no agent can be moved to it.', 409);
    const openrigHome = this.env.OPENRIG_HOME || join(this.home, '.openrig');
    const dir = before?.dir ?? join(openrigHome, 'community-harnesses');
    const preset = join(dir, 'opencode.yaml');
    if (existsSync(preset)) {
      return [`${preset} already exists and was left as it is.`];
    }
    const launcher = join(dir, 'opencode-launch.sh');
    await mkdir(dir, { recursive: true });
    await writeFile(launcher, opencodeLauncher(program));
    await chmod(launcher, 0o755);
    await writeFile(preset, opencodePreset(launcher));

    const after = await this.presets();
    const read = after?.harnesses.find((h) => h.name === 'opencode');
    if (after && (!read || !read.usable)) {
      await rm(preset, { force: true });
      await rm(launcher, { force: true });
      throw new SettingsError(`OpenRig refused the opencode preset this office wrote, so it was removed: ${read?.problem ?? 'not listed'}`, 502);
    }
    this.forget();
    return [
      `Installed opencode for OpenRig: ${preset} and ${launcher}.`,
      ...(after ? [] : ['OpenRig could not be asked to check the new preset; run "rig community-harness list" to see it.']),
    ];
  }
}

/** Starts opencode for an OpenRig seat, handing it the seat's model (OPENRIG_MODEL) through its inline config. */
export function opencodeLauncher(program: string): string {
  return `#!/bin/sh
# Written by OpenRig Space. Starts opencode in an OpenRig seat; the seat's model, if it has one,
# reaches opencode as inline config because its interactive command has no --model flag.
if [ -n "$OPENRIG_MODEL" ]; then
  model=$(printf '%s' "$OPENRIG_MODEL" | sed 's/[\\\\"]/\\\\&/g')
  OPENCODE_CONFIG_CONTENT="{\\"model\\":\\"$model\\"}"
  export OPENCODE_CONFIG_CONTENT
fi
exec ${JSON.stringify(program)} "$@"
`;
}

export function opencodePreset(launcher: string): string {
  return `# Written by OpenRig Space so OpenRig can run opencode as a community harness.
format: 1
name: opencode
command: ${JSON.stringify(launcher)}
maintainer: OpenRig Space
limits:
  - Not tested by OpenRig.
  - No resume; every launch starts a new opencode session.
  - Whether it needs you is read from the screen only.
passes_model: true
`;
}

interface Yaml {
  path: string;
  /** The text on disk when it was read. */
  original: string;
  text: string;
  doc: Document;
  lines: LineCounter;
}

function parse(path: string, original: string, text: string): Yaml {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines });
  if (doc.errors.length > 0) throw new SettingsError(`${path} could not be read: ${doc.errors[0]!.message}`, 502);
  return { path, original, text, doc, lines };
}

async function load(path: string): Promise<Yaml | null> {
  try {
    const text = await readFile(path, 'utf8');
    return parse(path, text, text);
  } catch (err) {
    if (err instanceof SettingsError) throw err;
    return null;
  }
}

/** Writes the file if its text changed, keeping the previous version beside it as `.bak`. */
async function save(file: Yaml): Promise<boolean> {
  if (file.text === file.original) return false;
  await copyFile(file.path, `${file.path}.bak`);
  const temp = `${file.path}.tmp-${process.pid}`;
  await writeFile(temp, file.text);
  await rename(temp, file.path);
  return true;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const localRef = (ref: unknown): string | null => (typeof ref === 'string' && ref.startsWith('local:') ? ref.slice(6) : null);

const PLAIN = /^[A-Za-z][A-Za-z0-9_.-]*$/;
/** A short list on one line, the way the team files already write them. Anything unusual is quoted. */
const flowList = (items: string[]) => `[${items.map((i) => (PLAIN.test(i) ? i : JSON.stringify(i))).join(', ')}]`;

/**
 * Sets, replaces or removes one key of a map by editing only its own lines,
 * so comments, wrapping and everything else in the file stay as they were.
 * `lines` are written at the key's indentation; null removes the key.
 */
function editKey(file: Yaml, mapPath: Array<string | number>, key: string, lines: string[] | null): Yaml {
  const map = file.doc.getIn(mapPath, true);
  if (!isMap(map) || map.items.length === 0 || !map.range) {
    throw new SettingsError(`${file.path} has no "${mapPath.join('.')}" section to put "${key}" in.`, 409);
  }
  const text = file.text;
  const lineStart = (offset: number) => text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = (offset: number) => {
    const at = text.indexOf('\n', offset);
    return at < 0 ? text.length : at + 1;
  };
  /** Start of the key's line and end of the last line its value reaches. */
  const span = (pair: YAMLMap['items'][number]): [number, number] => {
    const k = pair.key as { range?: [number, number, number] };
    const v = pair.value as { range?: [number, number, number] } | null;
    let end = v?.range?.[1] ?? k.range![1];
    while (end > k.range![0] && /\s/.test(text[end - 1]!)) end--;
    return [lineStart(k.range![0]), lineEnd(end)];
  };
  const first = map.items[0]!.key as { range: [number, number, number] };
  const indent = ' '.repeat(file.lines.linePos(first.range[0]).col - 1);
  const block = lines ? lines.map((l) => `${indent}${l}\n`).join('') : '';
  const pair = map.items.find((p) => isScalar(p.key) && p.key.value === key);

  let next: string;
  if (pair) {
    const [from, to] = span(pair);
    const value = pair.value as { range?: [number, number, number] } | null;
    const oneLine = lines?.length === 1 && value?.range && !text.slice(from, to).trimEnd().includes('\n') && isScalar(pair.value);
    if (oneLine) {
      // Only the value is swapped, so a comment after it stays.
      next = text.slice(0, value!.range![0]) + lines![0]!.slice(key.length + 2) + text.slice(value!.range![1]);
    } else {
      next = text.slice(0, from) + block + text.slice(to);
    }
  } else if (lines) {
    // A new key goes straight after the last one of the map.
    let at = span(map.items[map.items.length - 1]!)[1];
    const glue = at === text.length && !text.endsWith('\n') ? '\n' : '';
    next = text.slice(0, at) + glue + block + text.slice(at);
  } else {
    return file;
  }
  return parse(file.path, file.original, next);
}

interface Located {
  rig: Yaml;
  /** Path of the member inside the rig document. */
  at: Array<string | number>;
  member: Record<string, unknown>;
  spec: Yaml | null;
  profile: string;
  pool: string[];
  /** How many members of this rig are built from the same agent file. */
  sharedBy: number;
}

/**
 * Agent settings kept where OpenRig reads them: the member entry in the rig's
 * `rig.yaml` (model, tool rules) and the agent's own `agent.yaml` (skills).
 * A seat that already exists keeps its own copy, so model and tool rules are
 * also handed to `rig seat set-model` and `rig seat set-permissions`.
 */
export class TeamFileSettings implements SettingsStore {
  private teamsDir: string;
  private run: RigRunner;
  private harnesses: HarnessCatalog;

  constructor(opts: TeamFileOptions = {}) {
    this.teamsDir = resolve(opts.teamsDir ?? defaultTeamsDir());
    this.run = opts.run ?? runRig;
    this.harnesses = opts.harnesses ?? new HarnessCatalog({ run: this.run });
  }

  /** The offered harnesses, with the agent's current one always among them. */
  private async runtimesFor(current: string | null): Promise<HarnessChoice[]> {
    const offered = await this.harnesses.list();
    if (!current || offered.some((h) => h.id === current)) return offered;
    return [{ id: current, liveSwitch: LIVE_SWITCH_RUNTIMES.includes(current), models: current === 'claude-code' ? [...MODEL_CHOICES] : [] }, ...offered];
  }

  private async locate(agent: SettingsAgent): Promise<Located | string> {
    if (!SAFE_NAME.test(agent.rig)) return `"${agent.rig}" is not a rig name this office can look up.`;
    const rigPath = join(this.teamsDir, agent.rig, 'rig.yaml');
    const rig = await load(rigPath);
    if (!rig) {
      return `There is no ${rigPath}. This rig is not defined by team files (built-in rigs are not), so its agents cannot be changed here.`;
    }
    const memberId = agent.name.startsWith(`${agent.pod}.`) ? agent.name.slice(agent.pod.length + 1) : agent.name;
    const pods = rig.doc.toJS().pods;
    const podIndex = Array.isArray(pods) ? pods.findIndex((p) => p?.id === agent.pod) : -1;
    const members = podIndex >= 0 ? pods[podIndex].members : null;
    const memberIndex = Array.isArray(members) ? members.findIndex((m) => m?.id === memberId) : -1;
    if (memberIndex < 0) return `${rigPath} has no member "${memberId}" in pod "${agent.pod}".`;
    const member = members[memberIndex] as Record<string, unknown>;

    const ref = localRef(member.agent_ref);
    const spec = ref ? await load(join(resolve(dirname(rigPath), ref), 'agent.yaml')) : null;
    const pool = new Set<string>();
    if (spec) {
      const js = spec.doc.toJS();
      const ids = (resources: unknown) =>
        strings((Array.isArray(resources) ? resources : []).map((s) => (s as { id?: unknown })?.id)).forEach((id) => pool.add(id));
      ids(js.resources?.skills);
      for (const imported of Array.isArray(js.imports) ? js.imports : []) {
        const from = localRef(imported?.ref);
        const other = from ? await load(join(resolve(dirname(spec.path), from), 'agent.yaml')) : null;
        ids(other?.doc.toJS().resources?.skills);
      }
    }
    const sharedBy = (pods as Array<{ members?: Array<{ agent_ref?: unknown }> }>)
      .flatMap((p) => p.members ?? [])
      .filter((m) => m.agent_ref === member.agent_ref).length;
    return {
      rig,
      at: ['pods', podIndex, 'members', memberIndex],
      member,
      spec,
      profile: typeof member.profile === 'string' ? member.profile : 'default',
      pool: [...pool].sort(),
      sharedBy,
    };
  }

  private describe(agent: SettingsAgent, found: Located, runtimes: HarnessChoice[]): AgentSettings {
    const runtime = typeof found.member.runtime === 'string' ? found.member.runtime : null;
    const skills = strings(found.spec?.doc.toJS().profiles?.[found.profile]?.uses?.skills);
    const rules = (found.member.claude_permissions ?? {}) as { allow?: unknown; deny?: unknown };
    return {
      editable: true,
      reason: null,
      runtime,
      runtimes,
      model: typeof found.member.model === 'string' ? found.member.model : null,
      skills,
      // A skill already in use stays on the list even if the pool no longer names it.
      availableSkills: [...new Set([...found.pool, ...skills])].sort(),
      // Tool rules are Claude Code's own; they follow the harness the file names.
      toolsEditable: (runtime ?? agent.runtime) === 'claude-code',
      allow: strings(rules.allow),
      deny: strings(rules.deny),
      files: [found.rig.path, ...(found.spec ? [found.spec.path] : [])],
    };
  }

  async read(agent: SettingsAgent): Promise<AgentSettings> {
    const found = await this.locate(agent);
    if (typeof found === 'string') {
      return {
        editable: false, reason: found, runtime: null, runtimes: [], model: null, skills: [], availableSkills: [],
        toolsEditable: false, allow: [], deny: [], files: [],
      };
    }
    const runtime = typeof found.member.runtime === 'string' ? found.member.runtime : null;
    return this.describe(agent, found, await this.runtimesFor(runtime));
  }

  async write(agent: SettingsAgent, patch: SettingsPatch): Promise<SettingsSaved> {
    const found = await this.locate(agent);
    if (typeof found === 'string') throw new SettingsError(found, 409);
    const fileRuntime = typeof found.member.runtime === 'string' ? found.member.runtime : null;
    const runtimes = await this.runtimesFor(fileRuntime);
    const before = this.describe(agent, found, runtimes);
    const notes: string[] = [];
    const { at } = found;
    let { rig, spec } = found;

    const runtimeChanged = patch.runtime !== undefined && patch.runtime !== before.runtime;
    const target = runtimeChanged ? runtimes.find((h) => h.id === patch.runtime) : undefined;
    if (runtimeChanged && !target) {
      throw new SettingsError(`"${patch.runtime}" is not a harness this office offers. Add it to BACKOFFICE_HARNESSES to offer it.`);
    }
    if (runtimeChanged) rig = editKey(rig, at, 'runtime', [`runtime: ${target!.id}`]);

    const modelChanged = patch.model !== undefined && patch.model !== before.model;
    if (modelChanged) rig = editKey(rig, at, 'model', patch.model ? [`model: ${patch.model}`] : null);

    const allow = patch.allow ?? before.allow;
    const deny = patch.deny ?? before.deny;
    const rulesChanged = !same(allow, before.allow) || !same(deny, before.deny);
    if (rulesChanged) {
      const ruled = runtimeChanged ? target!.id === 'claude-code' : before.toolsEditable;
      if (!ruled) throw new SettingsError(`Tool rules cannot be set for a ${target?.id ?? before.runtime ?? agent.runtime} agent here.`);
      const block = ['claude_permissions:'];
      if (allow.length) block.push(`  allow: ${flowList(allow)}`);
      if (deny.length) block.push(`  deny: ${flowList(deny)}`);
      rig = editKey(rig, at, 'claude_permissions', block.length > 1 ? block : null);
    }

    const skillsChanged = patch.skills !== undefined && !same(patch.skills, before.skills);
    if (skillsChanged) {
      if (!spec) throw new SettingsError('This agent has no agent file of its own to keep skills in.');
      const unknown = patch.skills!.find((id) => !before.availableSkills.includes(id));
      if (unknown) throw new SettingsError(`There is no skill called "${unknown}" for this agent.`);
      spec = editKey(spec, ['profiles', found.profile, 'uses'], 'skills', [`skills: ${flowList(patch.skills!)}`]);
    }

    // Read the edited text back before anything is written: it must say exactly what was asked.
    const member = (rig.doc.getIn(at) as YAMLMap).toJSON() as Record<string, unknown>;
    const check = this.describe(agent, { ...found, rig, spec, member }, runtimes);
    const wanted = {
      runtime: runtimeChanged ? target!.id : before.runtime,
      model: patch.model !== undefined ? patch.model : before.model,
      skills: patch.skills ?? before.skills,
      allow,
      deny,
    };
    if (check.runtime !== wanted.runtime || check.model !== wanted.model || !same(check.skills, wanted.skills) || !same(check.allow, allow) || !same(check.deny, deny)) {
      throw new SettingsError('The team files have a shape this office cannot edit safely. Nothing was written.', 409);
    }

    // A community harness must be launchable before any file names it.
    if (target && !target.liveSwitch) {
      if (target.id === 'opencode') {
        notes.push(...(await this.harnesses.ensureOpencode()));
      } else {
        const preset = (await this.harnesses.presets())?.harnesses.find((h) => h.name === target.id);
        if (preset && !preset.usable) throw new SettingsError(`OpenRig cannot use its ${target.id} preset: ${preset.problem ?? 'no reason given'}`, 409);
      }
    }

    if ((runtimeChanged || modelChanged || rulesChanged) && (await save(rig))) notes.push(`Updated ${rig.path}.`);
    if (spec && skillsChanged && (await save(spec))) {
      notes.push(`Updated ${spec.path}.`);
      if (found.sharedBy > 1) notes.push(`${found.sharedBy} agents of this rig are built from that file, so they all get these skills.`);
    }
    if (skillsChanged) notes.push('Skills reach an agent only when it is launched fresh; the running conversation keeps the ones it has.');

    // The seat OpenRig already created keeps its own record, which the files do not touch.
    const liveSwitch = runtimeChanged && target!.liveSwitch && agent.runtime !== target!.id;
    if (liveSwitch) {
      const args = ['seat', 'set-runtime', agent.session, '--runtime', target!.id, '--reason', REASON];
      if (wanted.model) args.push('--model', wanted.model);
      const done = await settleWithin(this.run(args), SWITCH_WAIT_MS);
      notes.push(
        done === 'pending'
          ? `${agent.name} is moving to ${target!.id}: a successor is starting with a fresh conversation and takes over once it confirms. Follow it with "rig seat status ${agent.session}".`
          : done.ok
            ? `${agent.name} moved to ${target!.id} with a fresh conversation. Messages sent during the switch were held; send them again.`
            : `The team file now says ${target!.id}, but OpenRig did not move the running seat: ${done.output}`,
      );
    } else if (runtimeChanged && !target!.liveSwitch) {
      notes.push(
        `${agent.name} keeps running on ${agent.runtime} for now. OpenRig cannot move a running seat to ${target!.id}; ` +
          `it starts on ${target!.id}, with a fresh conversation, when the rig is brought up again from its team file ` +
          `("rig up ${rig.path} --plan" shows what that would do).`,
      );
    } else if (runtimeChanged) {
      notes.push(`The running seat is already on ${target!.id}.`);
    }

    // On a harness change the model went with the switch, or belongs to a harness the seat is not on yet.
    if (!runtimeChanged && modelChanged && patch.model) {
      const done = await this.run(['seat', 'set-model', agent.session, '--model', patch.model, '--reason', REASON]);
      notes.push(
        done.ok
          ? `Model saved on the seat: ${agent.name} uses ${patch.model} from its next restart.`
          : `The file is updated, but OpenRig did not save the model on the running seat: ${done.output}`,
      );
    } else if (!runtimeChanged && modelChanged) {
      notes.push('The model line was removed from the team file. OpenRig has no way to clear a model already saved on a seat; pick a model to change it.');
    }
    if (rulesChanged) {
      const dir = await mkdtemp(join(tmpdir(), 'backoffice-rules-'));
      try {
        const file = join(dir, 'rules.json');
        await writeFile(file, JSON.stringify({ allow, deny }));
        const done = await this.run(['seat', 'set-permissions', agent.session, '--rules', file, '--reason', REASON]);
        notes.push(
          done.ok
            ? `Tool rules saved on the seat: they apply from ${agent.name}'s next restart.`
            : `The file is updated, but OpenRig did not save the tool rules on the running seat: ${done.output}`,
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    if (notes.length === 0) notes.push('Nothing changed.');

    const after = await this.locate(agent);
    if (typeof after === 'string') throw new SettingsError(after, 502);
    const afterRuntime = typeof after.member.runtime === 'string' ? after.member.runtime : null;
    return { settings: this.describe(agent, after, await this.runtimesFor(afterRuntime)), notes };
  }
}
