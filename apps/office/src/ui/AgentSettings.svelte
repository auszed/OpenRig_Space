<script lang="ts">
  import { MODEL_CHOICES, type Agent, type AgentSettings } from '@backoffice/core';
  import type { OfficeStore } from '../state/office.svelte.ts';

  let { store, agent }: { store: OfficeStore; agent: Agent } = $props();

  const STATUS = { working: 'Working', idle: 'Idle', 'needs-input': 'Needs you', unknown: 'Unknown' } as const;
  const WHERE = { desk: 'At its desk', lounge: 'In the lounge', review: 'In the PR review room' } as const;

  /** What the office knows about this agent, live from the snapshot. */
  const params = $derived<Array<[string, string]>>([
    ['Name', agent.name],
    ['Rig', agent.rig],
    ['Pod', agent.pod],
    ['Session', agent.session],
    ['Seat id', agent.id],
    ['Kind', agent.kind],
    ['Harness (running)', agent.runtime],
    ['Model', agent.model ?? 'Runtime default'],
    ['Status', STATUS[agent.status] + (agent.statusReason ? ` · ${agent.statusReason}` : '')],
    ['Where', WHERE[store.whereIs(agent)]],
    ['Context used', agent.contextUsedPct === null ? '–' : `${agent.contextUsedPct}%`],
    ['Work', `${agent.work.assigned} assigned · ${agent.work.inProgress} in progress · ${agent.work.pending} pending · ${agent.work.blocked} blocked`],
    ['Last activity', agent.lastActivityAt ? new Date(agent.lastActivityAt).toLocaleString() : '–'],
  ]);

  let settings = $state<AgentSettings | null>(null);
  let loadError = $state<string | null>(null);
  let runtime = $state('');
  let cwd = $state('');
  let cwdScope = $state<'agent' | 'rig'>('agent');
  let workspace = $state<Record<string, string> | null>(null);
  // svelte-ignore state_referenced_locally
  store.readWorkspace().then((w) => (workspace = w), () => (workspace = null));
  let model = $state('');
  let skills = $state<string[]>([]);
  let allow = $state('');
  let deny = $state('');
  let saving = $state(false);
  let notes = $state<string[]>([]);
  let saveError = $state<string | null>(null);

  const rules = (text: string) => [...new Set(text.split('\n').map((l) => l.trim()).filter(Boolean))];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

  function show(next: AgentSettings) {
    settings = next;
    runtime = next.runtime ?? agent.runtime;
    cwd = next.cwd ?? '';
    cwdScope = 'agent';
    model = next.model ?? '';
    skills = [...next.skills];
    allow = next.allow.join('\n');
    deny = next.deny.join('\n');
  }

  // The component is rebuilt for each agent, so this runs once per agent.
  // svelte-ignore state_referenced_locally
  store.readSettings(agent.id).then(show, (err) => (loadError = (err as Error).message));

  const savedRuntime = $derived(settings?.runtime ?? agent.runtime);
  const runtimeChanged = $derived(settings !== null && runtime !== savedRuntime);
  const harness = $derived(settings?.runtimes.find((h) => h.id === runtime) ?? null);
  const models = $derived(harness ? harness.models : runtime === 'claude-code' ? [...MODEL_CHOICES] : []);
  // Tool rules are Claude Code's; they can be edited only while the agent stays on it.
  const rulesEditable = $derived(settings !== null && settings.toolsEditable && !runtimeChanged);

  const cwdChanged = $derived(settings !== null && cwd.trim() !== '' && cwd.trim() !== (settings.cwd ?? ''));

  const dirty = $derived(
    settings !== null &&
      (runtimeChanged ||
        cwdChanged ||
        model.trim() !== (settings.model ?? '') ||
        !same([...skills].sort(), [...settings.skills].sort()) ||
        !same(rules(allow), settings.allow) ||
        !same(rules(deny), settings.deny)),
  );

  async function save() {
    if (!settings || saving) return;
    if (runtimeChanged && harness) {
      const how = harness.liveSwitch
        ? `OpenRig moves the running seat now: a successor starts on ${runtime} with a fresh conversation and takes over.`
        : `The team file is changed now; the seat starts on ${runtime}, with a fresh conversation, the next time the rig is brought up from it.`;
      if (!confirm(`Move ${agent.name} from ${savedRuntime} to ${runtime}?\n\n${how}\n\nThe current conversation is not carried over.`)) return;
    }
    if (cwdChanged && cwdScope === 'rig' && settings.cwdSharedBy > 1) {
      if (!confirm(`Move all ${settings.cwdSharedBy} agents of ${agent.rig} that work in ${settings.cwd ?? 'the current folder'} to ${cwd.trim()}?\n\nUsed from each agent's next fresh launch. Files already in the old folder are not moved.`)) return;
    }
    saving = true;
    saveError = null;
    notes = [];
    try {
      // Skills keep the order they have in the file; new ones go at the end.
      const kept = settings.skills.filter((id) => skills.includes(id));
      const saved = await store.saveSettings(agent.id, {
        ...(runtimeChanged ? { runtime } : {}),
        ...(cwdChanged ? { cwd: cwd.trim(), cwdScope } : {}),
        model: model.trim() || null,
        skills: [...kept, ...skills.filter((id) => !kept.includes(id))],
        ...(rulesEditable ? { allow: rules(allow), deny: rules(deny) } : {}),
      });
      show(saved.settings);
      notes = saved.notes;
    } catch (err) {
      saveError = (err as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<section aria-label="Agent settings">
  <div class="group">
    <h3>Parameters</h3>
    <dl class="params">
      {#each params as [label, value] (label)}
        <dt>{label}</dt><dd>{value}</dd>
      {/each}
    </dl>
  </div>

  {#if loadError}
    <p class="error">{loadError}</p>
  {:else if !settings}
    <p class="muted">Reading…</p>
  {:else if !settings.editable}
    <h3>Settings</h3>
    <p class="muted">{settings.reason}</p>
  {:else}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div class="group">
        <label for="set-runtime">Harness</label>
        <select id="set-runtime" bind:value={runtime}>
          {#each settings.runtimes as choice (choice.id)}
            <option value={choice.id}>{choice.id}{choice.id === savedRuntime ? ' (current)' : ''}</option>
          {/each}
        </select>
        {#if runtimeChanged && harness}
          <p class="warn">
            {harness.liveSwitch
              ? `Switches the running seat now. ${agent.name} starts again on ${runtime} with a fresh conversation.`
              : `Saved to the team file. ${agent.name} starts on ${runtime}, with a fresh conversation, when the rig is brought up again.`}
          </p>
        {:else}
          <p class="muted">The coding tool this agent runs in. Offered: set BACKOFFICE_HARNESSES on the server to choose.</p>
        {/if}
      </div>

      <div class="group">
        <label for="set-cwd">Working folder</label>
        <input id="set-cwd" placeholder={settings.cwd === null ? 'Not set in the team file' : ''} maxlength="300" bind:value={cwd} />
        {#if settings.cwd === '.'}
          <p class="muted">"." means the folder chosen when the rig was started. Type a full path (/… or ~/…) to fix it.</p>
        {/if}
        {#if cwdChanged && settings.cwdSharedBy > 1}
          <div class="scope" role="radiogroup" aria-label="Who moves to the new folder">
            <label class="check"><input type="radio" value="agent" bind:group={cwdScope} />Only {agent.name}</label>
            <label class="check"><input type="radio" value="rig" bind:group={cwdScope} />Everyone in {agent.rig} who works in {settings.cwd ?? 'this folder'} ({settings.cwdSharedBy} agents)</label>
          </div>
        {/if}
        <p class="muted">Where this agent works and saves its files. Used from its next fresh launch; existing files are not moved.</p>
      </div>

      <div class="group">
        <label for="set-model">Model</label>
        <input id="set-model" list="model-choices" placeholder="Default for {runtime}" maxlength="120" bind:value={model} />
        <datalist id="model-choices">
          {#each models as choice (choice)}<option value={choice}></option>{/each}
        </datalist>
        <p class="muted">
          {runtimeChanged ? `A model for ${runtime}; it goes with the switch.` : "Used from this agent's next restart."}
          Leave empty for {runtime}'s default.
        </p>
      </div>

      <fieldset class="group">
        <legend>Skills</legend>
        <div class="skills">
          {#each settings.availableSkills as id (id)}
            <label class="check"><input type="checkbox" value={id} bind:group={skills} />{id}</label>
          {/each}
        </div>
        <p class="muted">Reach the agent only when it is launched fresh, not on a restart of the same conversation.</p>
      </fieldset>

      {#if rulesEditable}
        <div class="group">
          <label for="set-allow">Tools allowed without asking</label>
          <textarea id="set-allow" rows="3" placeholder="One rule per line, e.g. WebSearch or Bash(git *)" bind:value={allow}></textarea>
          <label for="set-deny">Tools never allowed</label>
          <textarea id="set-deny" rows="2" placeholder="One rule per line" bind:value={deny}></textarea>
          <p class="muted">Used from this agent's next restart. Rules the whole team gets are not listed here.</p>
        </div>
      {:else}
        <p class="muted">Tool rules can be set here only for a claude-code agent{runtimeChanged ? ', so they stay as they are' : ''}.</p>
      {/if}

      {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
      {#if notes.length > 0}
        <ul class="notes" role="status">
          {#each notes as note (note)}<li>{note}</li>{/each}
        </ul>
      {/if}

      <div class="row">
        <button type="button" class="ghost" disabled={!dirty || saving} onclick={() => settings && show(settings)}>Discard changes</button>
        <button class="primary" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      {#if workspace?.root}
        <div class="group">
          <h3>OpenRig records (all rigs)</h3>
          <p class="muted">
            Missions, slices and specs are kept in <code>{workspace.root}</code>, shared by every rig on this machine.
            Change it with <code>rig config set workspace.root &lt;folder&gt;</code>.
          </p>
        </div>
      {/if}
      {#if settings.files.length > 0}
        <p class="muted files">Saved in: {#each settings.files as file (file)}<code>{file}</code>{/each}</p>
      {/if}
    </form>
  {/if}
</section>

<style>
  section,
  form {
    display: grid;
    gap: 12px;
    align-content: start;
  }
  .group {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  h3,
  legend,
  .group > label {
    margin: 0;
    padding: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  p {
    margin: 0;
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
  }
  .error {
    color: #d92d20;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .warn {
    margin: 0;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--accent);
    font-size: 12px;
  }
  select,
  input:not([type='checkbox']),
  textarea {
    width: 100%;
    padding: 7px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: var(--text);
    font: inherit;
  }
  textarea {
    resize: vertical;
    font: 12px/1.45 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  }
  .skills {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 4px 10px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .notes {
    margin: 0;
    padding: 8px 10px 8px 24px;
    border-radius: 8px;
    border: 1px solid var(--border);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .ghost,
  .primary {
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: none;
  }
  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .scope {
    display: grid;
    gap: 4px;
  }
  .params {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    font-size: 12px;
  }
  .params dt {
    color: var(--muted);
  }
  .params dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .ghost:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .files code {
    display: block;
    overflow-wrap: anywhere;
  }
</style>
