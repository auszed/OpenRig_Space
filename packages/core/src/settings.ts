import type { Agent } from './model.ts';

/** One harness an agent can run on, as offered in the settings. */
export interface HarnessChoice {
  /** OpenRig's runtime name: "claude-code", "codex", "pi", or a community harness such as "opencode". */
  id: string;
  /** OpenRig can move a running seat onto it straight away (`rig seat set-runtime`). */
  liveSwitch: boolean;
  /** Model ids to suggest for it; any other id can still be typed in. */
  models: string[];
}

/** The harnesses OpenRig switches a running seat between. Anything else only takes effect at a fresh launch. */
export const LIVE_SWITCH_RUNTIMES: readonly string[] = ['claude-code', 'codex', 'pi'];

/** What can be set for one agent: its harness, model, skills and the tools it may use without asking. */
export interface AgentSettings {
  /** False when there is nothing to edit; `reason` then says why. */
  editable: boolean;
  reason: string | null;
  /** The harness the team file names for this agent, or null when it names none. */
  runtime: string | null;
  /** The harnesses it may be moved to, the current one included. */
  runtimes: HarnessChoice[];
  /** Null means no model is set for this agent and the runtime's own default applies. */
  model: string | null;
  /** The working folder as the team file writes it ("~/work", ".", …), or null when it names none. */
  cwd: string | null;
  /** How many members of the rig share that folder, this one included. */
  cwdSharedBy: number;
  skills: string[];
  availableSkills: string[];
  /** Tool rules only exist for some runtimes. */
  toolsEditable: boolean;
  allow: string[];
  deny: string[];
  /** The files these values are read from and written to. */
  files: string[];
}

export type CwdScope = 'agent' | 'rig';

export interface SettingsPatch {
  runtime?: string;
  cwd?: string;
  /** "rig" also moves every member of the rig that shares this agent's current folder. */
  cwdScope?: CwdScope;
  model?: string | null;
  skills?: string[];
  allow?: string[];
  deny?: string[];
}

export interface SettingsSaved {
  settings: AgentSettings;
  /** Plain sentences about what was written and when it takes effect. */
  notes: string[];
}

export type SettingsAgent = Pick<Agent, 'name' | 'session' | 'rig' | 'pod' | 'runtime'>;

export interface SettingsStore {
  read(agent: SettingsAgent): Promise<AgentSettings>;
  write(agent: SettingsAgent, patch: SettingsPatch): Promise<SettingsSaved>;
}

/** A refusal the person can act on; `status` is the HTTP status it maps to. */
export class SettingsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Model names people commonly pick; any other id can be typed in. */
export const MODEL_CHOICES = ['fable', 'opus', 'sonnet', 'haiku'] as const;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#@[\]-]{0,119}$/;
const RUNTIME_ID = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const MAX_RULES = 100;
const MAX_RULE_LENGTH = 200;

function stringList(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_RULES) {
    throw new SettingsError(`${what} must be a list of at most ${MAX_RULES} entries.`);
  }
  const out: string[] = [];
  for (const entry of value) {
    const text = typeof entry === 'string' ? entry.trim() : '';
    if (!text || text.length > MAX_RULE_LENGTH || /[\r\n]/.test(text)) {
      throw new SettingsError(`Each entry in ${what} must be one line of 1 to ${MAX_RULE_LENGTH} characters.`);
    }
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

/** Checks a patch from outside and returns a clean copy. Throws `SettingsError` on anything odd. */
export function cleanPatch(input: unknown): SettingsPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SettingsError('Send the settings as a JSON object.');
  const raw = input as Record<string, unknown>;
  const patch: SettingsPatch = {};
  if ('model' in raw) {
    const model = raw.model === null ? null : typeof raw.model === 'string' ? raw.model.trim() : undefined;
    if (model === undefined || (model !== null && model !== '' && !MODEL_ID.test(model))) {
      throw new SettingsError('That does not look like a model name.');
    }
    patch.model = model || null;
  }
  if ('runtime' in raw) {
    const runtime = typeof raw.runtime === 'string' ? raw.runtime.trim() : '';
    if (!RUNTIME_ID.test(runtime)) throw new SettingsError('That does not look like a harness name.');
    patch.runtime = runtime;
  }
  if ('cwd' in raw) {
    const cwd = typeof raw.cwd === 'string' ? raw.cwd.trim() : '';
    if (!cwd || cwd.length > 300 || /[\r\n"\\]/.test(cwd) || !/^(\/|~\/)/.test(cwd) || cwd.split('/').includes('..')) {
      throw new SettingsError('The folder must be a full path starting with / or ~/, without "..".');
    }
    patch.cwd = cwd.length > 1 ? cwd.replace(/\/+$/, '') : cwd;
  }
  if ('cwdScope' in raw) {
    if (raw.cwdScope !== 'agent' && raw.cwdScope !== 'rig') throw new SettingsError('cwdScope must be "agent" or "rig".');
    patch.cwdScope = raw.cwdScope;
  }
  if ('skills' in raw) patch.skills = stringList(raw.skills, 'skills');
  if ('allow' in raw) patch.allow = stringList(raw.allow, 'allowed tools');
  if ('deny' in raw) patch.deny = stringList(raw.deny, 'denied tools');
  return patch;
}

const MOCK_RUNTIMES: HarnessChoice[] = [
  { id: 'claude-code', liveSwitch: true, models: [...MODEL_CHOICES] },
  { id: 'opencode', liveSwitch: false, models: ['opencode/big-pickle', 'anthropic/claude-sonnet-5-5'] },
];

const MOCK_SKILLS = ['code-review', 'systematic-debugging', 'test-driven-development', 'verification-before-completion'];

/** Settings kept in memory, for the mock office and for tests. Nothing is written anywhere. */
export class MemorySettings implements SettingsStore {
  private saved = new Map<string, SettingsPatch>();

  async read(agent: SettingsAgent): Promise<AgentSettings> {
    const s = this.saved.get(agent.session) ?? {};
    return {
      editable: true,
      reason: null,
      runtime: s.runtime ?? 'claude-code',
      runtimes: MOCK_RUNTIMES,
      model: s.model ?? null,
      cwd: s.cwd ?? '~/mock-project',
      cwdSharedBy: 4,
      skills: s.skills ?? ['systematic-debugging'],
      availableSkills: MOCK_SKILLS,
      toolsEditable: (s.runtime ?? 'claude-code') === 'claude-code',
      allow: s.allow ?? [],
      deny: s.deny ?? [],
      files: [],
    };
  }

  async write(agent: SettingsAgent, patch: SettingsPatch): Promise<SettingsSaved> {
    const unknown = patch.skills?.find((id) => !MOCK_SKILLS.includes(id));
    if (unknown) throw new SettingsError(`There is no skill called "${unknown}".`);
    if (patch.runtime && !MOCK_RUNTIMES.some((r) => r.id === patch.runtime)) {
      throw new SettingsError(`"${patch.runtime}" is not a harness this office offers.`);
    }
    this.saved.set(agent.session, { ...this.saved.get(agent.session), ...patch });
    return { settings: await this.read(agent), notes: ['Saved in memory only: this is the mock office.'] };
  }
}
