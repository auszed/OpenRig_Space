<script lang="ts">
  import { reasonLabel, type Agent } from '@backoffice/core';
  import type { OfficeStore } from '../state/office.svelte.ts';

  let { store, agent }: { store: OfficeStore; agent: Agent } = $props();

  const LABEL = { working: 'Working', idle: 'Idle', 'needs-input': 'Needs you', unknown: 'Unknown' } as const;
  const tasks = $derived(store.tasksFor(agent));
  const following = $derived(store.followId === agent.id);
  // The agent object is replaced on every update; its id is what the panel is really about.
  const agentId = $derived(agent.id);

  let screen = $state('');
  let screenError = $state<string | null>(null);
  let screenEl = $state<HTMLPreElement>();

  // Re-read the agent's screen every few seconds while its panel is open.
  $effect(() => {
    const id = agentId;
    let live = true;
    screen = '';
    screenError = null;
    const read = async () => {
      try {
        const text = await store.readScreen(id);
        if (!live) return;
        const atBottom = !screenEl || screenEl.scrollHeight - screenEl.scrollTop - screenEl.clientHeight < 24;
        screen = text;
        screenError = null;
        if (atBottom) queueMicrotask(() => screenEl && (screenEl.scrollTop = screenEl.scrollHeight));
      } catch (err) {
        if (live) screenError = (err as Error).message;
      }
    };
    void read();
    const timer = setInterval(read, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  });

  let draft = $state('');
  let sending = $state(false);
  let notice = $state<{ ok: boolean; text: string } | null>(null);
  $effect(() => {
    agentId;
    draft = '';
    notice = null;
  });

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    sending = true;
    notice = null;
    try {
      await store.sendMessage(agent.id, text);
      draft = '';
      notice = { ok: true, text: `Sent to ${agent.name}.` };
    } catch (err) {
      notice = { ok: false, text: `Not sent: ${(err as Error).message}` };
    } finally {
      sending = false;
    }
  }
</script>

<aside aria-label="Agent details">
  <div class="head">
    <span class="swatch" style:background={store.colorOf(agent)}></span>
    <div class="title">
      <h2>{agent.name}</h2>
      <p>{agent.rig} · {agent.pod} · {agent.runtime}{agent.model ? ` · ${agent.model}` : ''}</p>
    </div>
    <button class="ghost" aria-pressed={following} onclick={() => store.toggleFollow(agent.id)}>
      {following ? 'Following' : 'Follow'}
    </button>
    <button class="ghost" aria-label="Close" onclick={() => store.select(null)}>✕</button>
  </div>

  <p class="status">
    <i style:background={store.theme.status[agent.status]}></i>
    <strong>{LABEL[agent.status]}</strong>
    {#if agent.statusReason}<span>{reasonLabel(agent.statusReason)}</span>{/if}
  </p>

  <dl>
    <div><dt>Assigned</dt><dd>{agent.work.assigned}</dd></div>
    <div><dt>In progress</dt><dd>{agent.work.inProgress}</dd></div>
    <div><dt>Blocked</dt><dd>{agent.work.blocked}</dd></div>
    <div><dt>Context used</dt><dd>{agent.contextUsedPct === null ? '–' : `${agent.contextUsedPct}%`}</dd></div>
  </dl>

  <h3>Tasks</h3>
  {#if tasks.length === 0}
    <p class="muted">Nothing open for this agent.</p>
  {:else}
    <ul class="tasks">
      {#each tasks as task (task.id)}
        <li>
          <span class="state">{task.state}</span>
          <span class="summary">{task.summary}</span>
          <span class="route">
            {task.to === agent.session ? `from ${task.from || 'unknown'}` : `to ${task.to || 'unknown'}`}
            {#if task.blockedOn}· waiting on {task.blockedOn}{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <h3>Screen</h3>
  {#if screenError}
    <p class="error">{screenError}</p>
  {/if}
  <pre bind:this={screenEl}>{screen || (screenError ? '' : 'Reading…')}</pre>

  <form
    onsubmit={(e) => {
      e.preventDefault();
      void send();
    }}
  >
    <label for="message">Message {agent.name}</label>
    <textarea
      id="message"
      rows="2"
      maxlength="4000"
      placeholder="Typed straight into this agent's prompt"
      bind:value={draft}
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void send();
        }
      }}
    ></textarea>
    <div class="row">
      {#if notice}<span class={notice.ok ? 'ok' : 'error'} role="status">{notice.text}</span>{/if}
      <button class="primary" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send'}</button>
    </div>
  </form>
</aside>

<style>
  aside {
    position: absolute;
    top: 70px;
    right: 12px;
    bottom: 12px;
    width: min(400px, calc(100vw - 24px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    overflow-y: auto;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .swatch {
    width: 10px;
    align-self: stretch;
    border-radius: 4px;
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  h3 {
    margin: 4px 0 0;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  p {
    margin: 0;
  }
  .title p,
  .muted {
    color: var(--muted);
    font-size: 12px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .status span {
    color: var(--muted);
  }
  i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin: 0;
  }
  dl div {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  dt {
    color: var(--muted);
    font-size: 11px;
  }
  dd {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .tasks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    max-height: 22vh;
    overflow-y: auto;
  }
  .tasks li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 12px;
  }
  .state {
    align-self: start;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--border);
    font-size: 11px;
  }
  .summary {
    overflow-wrap: anywhere;
  }
  .route {
    grid-column: 2;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  pre {
    flex: 1;
    min-height: 140px;
    margin: 0;
    padding: 10px;
    border-radius: 8px;
    background: var(--screen-bg);
    color: var(--screen-text);
    font: 11px/1.45 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    overflow-y: auto;
  }
  form {
    display: grid;
    gap: 6px;
  }
  label {
    font-size: 12px;
    font-weight: 600;
  }
  textarea {
    width: 100%;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    resize: vertical;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    min-height: 32px;
  }
  .row span {
    flex: 1;
    font-size: 12px;
  }
  .ok {
    color: var(--muted);
  }
  .error {
    color: #d92d20;
    font-size: 12px;
  }
  .ghost,
  .primary {
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: none;
  }
  .ghost[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
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
</style>
