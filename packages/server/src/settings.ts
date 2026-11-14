import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isMap, isScalar, LineCounter, parseDocument, type Document, type YAMLMap } from 'yaml';
import {
  SettingsError,
  type AgentSettings, type SettingsAgent, type SettingsPatch, type SettingsSaved, type SettingsStore,
} from '@backoffice/core';

/** Runs the `rig` command line with these arguments. */
export type RigRunner = (args: string[]) => Promise<{ ok: boolean; output: string }>;

export interface TeamFileOptions {
  /** Folder holding one sub-folder per rig, each with a `rig.yaml`. */
  teamsDir?: string;
  /** Replaced in tests; by default the `rig` on the PATH is run. */
  run?: RigRunner;
}

const REASON = 'Set in OpenRig Space';

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

  constructor(opts: TeamFileOptions = {}) {
    this.teamsDir = resolve(opts.teamsDir ?? defaultTeamsDir());
    this.run = opts.run ?? runRig;
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

  private describe(agent: SettingsAgent, found: Located): AgentSettings {
    const skills = strings(found.spec?.doc.toJS().profiles?.[found.profile]?.uses?.skills);
    const rules = (found.member.claude_permissions ?? {}) as { allow?: unknown; deny?: unknown };
    return {
      editable: true,
      reason: null,
      model: typeof found.member.model === 'string' ? found.member.model : null,
      skills,
      // A skill already in use stays on the list even if the pool no longer names it.
      availableSkills: [...new Set([...found.pool, ...skills])].sort(),
      toolsEditable: agent.runtime === 'claude-code',
      allow: strings(rules.allow),
      deny: strings(rules.deny),
      files: [found.rig.path, ...(found.spec ? [found.spec.path] : [])],
    };
  }

  async read(agent: SettingsAgent): Promise<AgentSettings> {
    const found = await this.locate(agent);
    if (typeof found === 'string') {
      return { editable: false, reason: found, model: null, skills: [], availableSkills: [], toolsEditable: false, allow: [], deny: [], files: [] };
    }
    return this.describe(agent, found);
  }

  async write(agent: SettingsAgent, patch: SettingsPatch): Promise<SettingsSaved> {
    const found = await this.locate(agent);
    if (typeof found === 'string') throw new SettingsError(found, 409);
    const before = this.describe(agent, found);
    const notes: string[] = [];
    const { at } = found;
    let { rig, spec } = found;

    const modelChanged = patch.model !== undefined && patch.model !== before.model;
    if (modelChanged) rig = editKey(rig, at, 'model', patch.model ? [`model: ${patch.model}`] : null);

    const allow = patch.allow ?? before.allow;
    const deny = patch.deny ?? before.deny;
    const rulesChanged = !same(allow, before.allow) || !same(deny, before.deny);
    if (rulesChanged) {
      if (!before.toolsEditable) throw new SettingsError(`Tool rules cannot be set for a ${agent.runtime} agent here.`);
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
    const check = this.describe(agent, { ...found, rig, spec, member });
    const wanted = { model: patch.model !== undefined ? patch.model : before.model, skills: patch.skills ?? before.skills, allow, deny };
    if (check.model !== wanted.model || !same(check.skills, wanted.skills) || !same(check.allow, allow) || !same(check.deny, deny)) {
      throw new SettingsError('The team files have a shape this office cannot edit safely. Nothing was written.', 409);
    }

    if ((modelChanged || rulesChanged) && (await save(rig))) notes.push(`Updated ${rig.path}.`);
    if (spec && skillsChanged && (await save(spec))) {
      notes.push(`Updated ${spec.path}.`);
      if (found.sharedBy > 1) notes.push(`${found.sharedBy} agents of this rig are built from that file, so they all get these skills.`);
    }
    if (skillsChanged) notes.push('Skills reach an agent only when it is launched fresh; the running conversation keeps the ones it has.');

    // The seat OpenRig already created keeps its own record, which the files do not touch.
    if (modelChanged && patch.model) {
      const done = await this.run(['seat', 'set-model', agent.session, '--model', patch.model, '--reason', REASON]);
      notes.push(
        done.ok
          ? `Model saved on the seat: ${agent.name} uses ${patch.model} from its next restart.`
          : `The file is updated, but OpenRig did not save the model on the running seat: ${done.output}`,
      );
    } else if (modelChanged) {
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
    return { settings: this.describe(agent, after), notes };
  }
}
