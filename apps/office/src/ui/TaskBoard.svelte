<script lang="ts">
  import { columnOf, isLead, isOpenTask, TASK_PRIORITIES, type BoardColumn, type QueueItem, type TaskPriority } from '@backoffice/core';
  import type { OfficeStore } from '../state/office.svelte.ts';

  let { store }: { store: OfficeStore } = $props();

  const COLUMNS: Array<[BoardColumn, string]> = [
    ['todo', 'To do'],
    ['doing', 'In progress'],
    ['blocked', 'Blocked'],
    ['done', 'Done · 7 days'],
  ];

  const rigs = $derived(store.teams.map((t) => t.rig));
  const showing = $derived(store.boardRigs.filter((r) => rigs.includes(r)));
  const all = $derived(showing.length === 0);
  const rows = $derived(store.snapshot.queue.filter((q) => all || (q.rig !== null && showing.includes(q.rig))));
  const byColumn = $derived(
    Object.fromEntries(COLUMNS.map(([id]) => [id, rows.filter((q) => columnOf(q.state) === id)])) as Record<BoardColumn, QueueItem[]>,
  );
  const openIn = (rig: string) => store.snapshot.queue.filter((q) => q.rig === rig && isOpenTask(q.state)).length;

  function toggleRig(rig: string) {
    store.setBoardRigs(showing.includes(rig) ? showing.filter((r) => r !== rig) : [...showing, rig]);
  }

  const agentAt = (session: string) => store.snapshot.agents.find((a) => a.session === session) ?? null;
  const who = (session: string) => agentAt(session)?.name ?? (session || 'unknown');

  function ago(iso: string): string {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  }

  // --- New task ----------------------------------------------------------------------------
  let composing = $state(false);
  let rig = $state('');
  let destination = $state('');
  let summary = $state('');
  let details = $state('');
  let priority = $state<TaskPriority>('routine');
  let sending = $state(false);
  let notice = $state<{ ok: boolean; text: string } | null>(null);

  const seats = $derived(store.teams.find((t) => t.rig === rig)?.pods.flatMap((p) => p.agents) ?? []);

  /** Work goes to the team's lead; a team without one gets its first seat, and the person can pick another. */
  function pickRig(next: string) {
    rig = next;
    const team = store.teams.find((t) => t.rig === next);
    destination = (team?.lead ?? team?.pods[0]?.agents[0])?.session ?? '';
  }

  function startTask() {
    notice = null;
    composing = true;
    pickRig(showing.length === 1 ? showing[0]! : rig && rigs.includes(rig) ? rig : (rigs[0] ?? ''));
  }

  async function create() {
    if (sending || !destination || !summary.trim()) return;
    sending = true;
    notice = null;
    try {
      await store.createTask({ destination, summary: summary.trim(), body: details.trim(), priority });
      notice = { ok: true, text: `Sent to ${who(destination)}. It shows in To do until the agent picks it up.` };
      summary = '';
      details = '';
      priority = 'routine';
      composing = false;
    } catch (err) {
      notice = { ok: false, text: (err as Error).message };
    } finally {
      sending = false;
    }
  }

  async function cancel(task: QueueItem) {
    const reason = prompt(`Cancel "${task.summary}"?\n\nOptional: why (kept on the task's record).`, '');
    if (reason === null) return;
    notice = null;
    try {
      await store.cancelTask(task.id, reason);
      notice = { ok: true, text: `Cancelled "${task.summary}".` };
    } catch (err) {
      notice = { ok: false, text: (err as Error).message };
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !composing && (store.boardOpen = false)} />

<div class="scrim" role="presentation" style:--board-opacity={store.boardOpacity} onclick={(e) => e.target === e.currentTarget && (store.boardOpen = false)}>
  <section class="board" aria-label="Task board">
    <header>
      <h2>Task board</h2>
      <div class="filters" role="group" aria-label="Show rigs">
        <button class="chip" aria-pressed={all} onclick={() => store.setBoardRigs([])}>All rigs</button>
        {#each rigs as name (name)}
          <button class="chip" aria-pressed={showing.includes(name)} onclick={() => toggleRig(name)}>
            {name}{#if openIn(name)}<span class="count">{openIn(name)}</span>{/if}
          </button>
        {/each}
      </div>
      <button class="primary" onclick={startTask} disabled={rigs.length === 0}>New task</button>
      <button class="ghost" aria-label="Close" onclick={() => (store.boardOpen = false)}>✕</button>
    </header>

    {#if composing}
      <form
        class="compose"
        onsubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label>Rig
          <select value={rig} onchange={(e) => pickRig(e.currentTarget.value)}>
            {#each rigs as name (name)}<option value={name}>{name}</option>{/each}
          </select>
        </label>
        <label>For
          <select bind:value={destination}>
            {#each seats as agent (agent.id)}
              <option value={agent.session}>{agent.name}{isLead(agent) ? ' (lead)' : ''}</option>
            {/each}
          </select>
        </label>
        <label>Priority
          <select bind:value={priority}>
            {#each TASK_PRIORITIES as p (p)}<option value={p}>{p}</option>{/each}
          </select>
        </label>
        <label class="wide">Title
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={summary} maxlength="200" required autofocus placeholder="e.g. Review the login change on branch fix-login" />
        </label>
        <label class="wide">Details
          <textarea bind:value={details} rows="4" maxlength="8000" placeholder="What done looks like, where the code is, anything the agent should know"></textarea>
        </label>
        <p class="muted wide">
          The task goes into OpenRig's queue for this agent, and OpenRig tells the agent. A lead shares the work out in its team;
          in a team without a lead, give it to the agent that should own it (in duo, dev.build builds and passes the change to dev.review).
        </p>
        <div class="row wide">
          <button type="button" class="ghost" onclick={() => (composing = false)}>Back</button>
          <button class="primary" disabled={sending || !destination || !summary.trim()}>{sending ? 'Sending…' : 'Create task'}</button>
        </div>
      </form>
    {/if}

    {#if notice}<p class={notice.ok ? 'ok' : 'error'} role="status">{notice.text}</p>{/if}

    <div class="columns">
      {#each COLUMNS as [id, label] (id)}
        <div class="column" aria-label={label}>
          <h3>{label} <span class="count">{byColumn[id].length}</span></h3>
          {#each byColumn[id] as task (task.id)}
            {@const owner = agentAt(task.to)}
            <article class="card" class:done={id === 'done'}>
              <p class="summary">{task.summary}</p>
              <div class="meta">
                {#if all || showing.length > 1}<span class="tag">{task.rig ?? '?'}</span>{/if}
                {#if task.priority && task.priority !== 'routine'}<span class="tag prio">{task.priority}</span>{/if}
                {#if owner}
                  <button class="owner" onclick={() => {
                    store.boardOpen = false;
                    store.select(owner.id);
                  }} title="Open {owner.name}">
                    <i style:background={store.colorOf(owner)}></i>{owner.name}
                  </button>
                {:else}
                  <span>{who(task.to)}</span>
                {/if}
              </div>
              <p class="muted small">
                from {who(task.from)}{#if task.blockedOn} · waiting on {task.blockedOn}{/if}{#if task.updatedAt} · {ago(task.updatedAt)}{/if}
              </p>
              {#if isOpenTask(task.state)}
                <button class="link" onclick={() => cancel(task)}>Cancel</button>
              {/if}
            </article>
          {:else}
            <p class="muted small empty">Nothing here.</p>
          {/each}
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  /* Starts below the top bar, so the bar (and its view settings) stays usable while the board is open. */
  .scrim {
    position: absolute;
    inset: 64px 0 0 0;
    z-index: 5 !important;
    display: grid;
    place-items: center;
    padding: 6px 12px 12px;
    background: color-mix(in srgb, var(--panel-solid) 8%, transparent);
  }
  .board {
    width: min(1180px, 100%);
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border-radius: 12px;
    /* See-through by the viewer's choice (View settings); the blur keeps text readable over the office. */
    background: color-mix(in srgb, var(--panel-solid) calc(var(--board-opacity, 0.85) * 100%), transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .filters {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    flex: 1;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }
  .chip[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
  }
  .count {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--border);
    color: var(--text);
    font-size: 11px;
    font-weight: 600;
  }
  .compose {
    background: color-mix(in srgb, var(--panel-solid) max(90%, calc(var(--board-opacity, 0.85) * 100%)), transparent);
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 12px;
    padding: 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
  }
  .compose label {
    display: grid;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .wide {
    grid-column: 1 / -1;
  }
  input,
  select,
  textarea {
    width: 100%;
    padding: 7px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    letter-spacing: normal;
    text-transform: none;
  }
  textarea {
    resize: vertical;
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .columns {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }
  .column {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    overflow-y: auto;
    padding: 8px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel-solid) calc(var(--board-opacity, 0.85) * 60%), transparent);
    border: 1px solid var(--border);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 2px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  /* Cards stay nearly solid at any board opacity, so their text is always legible. */
  .card {
    display: grid;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel-solid) max(92%, calc(var(--board-opacity, 0.85) * 100%)), transparent);
    border: 1px solid var(--border);
  }
  .card.done {
    opacity: 0.65;
  }
  .summary {
    margin: 0;
    font-weight: 600;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 12px;
  }
  .tag {
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--border);
    font-size: 11px;
    font-weight: 600;
  }
  .tag.prio {
    background: var(--accent);
    color: var(--accent-text);
  }
  .owner {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-decoration: underline;
    text-decoration-color: var(--border);
  }
  .owner i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  p {
    margin: 0;
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
  }
  .small {
    font-size: 11px;
  }
  .empty {
    padding: 4px 2px;
  }
  .ok {
    color: var(--muted);
    font-size: 12px;
  }
  .error {
    color: #d92d20;
    font-size: 12px;
  }
  .link {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 11px;
    text-decoration: underline;
  }
  .link:hover {
    color: #d92d20;
  }
  .ghost,
  .primary {
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text);
    font: inherit;
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
  @media (max-width: 860px) {
    .columns {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      overflow-y: auto;
    }
    .compose {
      grid-template-columns: 1fr;
    }
  }
</style>
