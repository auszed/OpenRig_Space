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
    ['Runtime', agent.runtime],
    ['Model', agent.model ?? 'Runtime default'],
    ['Status', STATUS[agent.status] + (agent.statusReason ? ` · ${agent.statusReason}` : '')],
    ['Where', WHERE[store.whereIs(agent)]],
    ['Context used', agent.contextUsedPct === null ? '–' : `${agent.contextUsedPct}%`],
    ['Work', `${agent.work.assigned} assigned · ${agent.work.inProgress} in progress · ${agent.work.pending} pending · ${agent.work.blocked} blocked`],
    ['Last activity', agent.lastActivityAt ? new Date(agent.lastActivityAt).toLocaleString() : '–'],
  ]);

  let settings = $state<AgentSettings | null>(null);
  let loadError = $state<string | null>(null);
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
    model = next.model ?? '';
    skills = [...next.skills];
    allow = next.allow.join('\n');
    deny = next.deny.join('\n');
  }

  // The component is rebuilt for each agent, so this runs once per agent.
  // svelte-ignore state_referenced_locally
  store.readSettings(agent.id).then(show, (err) => (loadError = (err as Error).message));

  const dirty = $derived(
    settings !== null &&
      (model.trim() !== (settings.model ?? '') ||
        !same([...skills].sort(), [...settings.skills].sort()) ||
        !same(rules(allow), settings.allow) ||
        !same(rules(deny), settings.deny)),
  );

  async function save() {
    if (!settings || saving) return;
    saving = true;
    saveError = null;
    notes = [];
    try {
      // Skills keep the order they have in the file; new ones go at the end.
      const kept = settings.skills.filter((id) => skills.includes(id));
      const saved = await store.saveSettings(agent.id, {
        model: model.trim() || null,
        skills: [...kept, ...skills.filter((id) => !kept.includes(id))],
        ...(settings.toolsEditable ? { allow: rules(allow), deny: rules(deny) } : {}),
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
        <label for="set-model">Model</label>
        <input id="set-model" list="model-choices" placeholder="Default for {agent.runtime}" maxlength="80" bind:value={model} />
        <datalist id="model-choices">
          {#each MODEL_CHOICES as choice (choice)}<option value={choice}></option>{/each}
        </datalist>
        <p class="muted">Used from this agent's next restart. Leave empty for no model of its own.</p>
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

      {#if settings.toolsEditable}
        <div class="group">
          <label for="set-allow">Tools allowed without asking</label>
          <textarea id="set-allow" rows="3" placeholder="One rule per line, e.g. WebSearch or Bash(git *)" bind:value={allow}></textarea>
          <label for="set-deny">Tools never allowed</label>
          <textarea id="set-deny" rows="2" placeholder="One rule per line" bind:value={deny}></textarea>
          <p class="muted">Used from this agent's next restart. Rules the whole team gets are not listed here.</p>
        </div>
      {:else}
        <p class="muted">Tool rules cannot be set here for a {agent.runtime} agent.</p>
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
