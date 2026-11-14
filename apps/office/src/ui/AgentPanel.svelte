<script lang="ts">
  import { parsePromptOptions, reasonLabel, type Agent, type PromptOption } from '@backoffice/core';
  import type { OfficeStore } from '../state/office.svelte.ts';
  import AgentSettings from './AgentSettings.svelte';

  let { store, agent }: { store: OfficeStore; agent: Agent } = $props();

  const LABEL = { working: 'Working', idle: 'Idle', 'needs-input': 'Needs you', unknown: 'Unknown' } as const;
  const tasks = $derived(store.tasksFor(agent));
  const following = $derived(store.followId === agent.id);
  // The agent object is replaced on every update; its id is what the panel is really about.
  const agentId = $derived(agent.id);

  let showSettings = $state(false);

  let screen = $state('');
  let screenError = $state<string | null>(null);
  let screenEl = $state<HTMLPreElement>();
  let rereadScreen: () => Promise<void> = async () => {};

  // The numbered question at the bottom of the screen, if the agent is stopped at one.
  const options = $derived(parsePromptOptions(screen));
  let answering = $state(false);
  let answerNotice = $state<{ ok: boolean; text: string } | null>(null);

  async function answer(option: PromptOption) {
    if (answering) return;
    answering = true;
    answerNotice = null;
    try {
      await store.answerPrompt(agent.id, option.key, option.label);
      answerNotice = { ok: true, text: `Pressed ${option.key} (${option.label}).` };
    } catch (err) {
      answerNotice = { ok: false, text: (err as Error).message };
    }
    // Give the terminal a moment to redraw, then show what it looks like now.
    await new Promise((done) => setTimeout(done, 700));
    await rereadScreen();
    answering = false;
  }

  // --- Moving and resizing the panel -------------------------------------------------------
  type Rect = { left: number; top: number; width: number; height: number };
  const RECT_KEY = 'backoffice.panel';
  const MIN_W = 300;
  const MIN_H = 260;
  let panelEl = $state<HTMLElement>();
  let rect = $state<Rect | null>(loadRect());

  function loadRect(): Rect | null {
    try {
      const r = JSON.parse(localStorage.getItem(RECT_KEY) ?? 'null');
      return r && [r.left, r.top, r.width, r.height].every(Number.isFinite) ? fit(r) : null;
    } catch {
      return null;
    }
  }
  function saveRect() {
    try {
      if (rect) localStorage.setItem(RECT_KEY, JSON.stringify(rect));
      else localStorage.removeItem(RECT_KEY);
    } catch {
      // Without storage the panel simply returns to its usual place next time.
    }
  }
  /** Keeps the panel a usable size and its header reachable inside the window. */
  function fit(r: Rect): Rect {
    const width = Math.min(Math.max(r.width, MIN_W), window.innerWidth);
    const top = Math.min(Math.max(r.top, 0), window.innerHeight - 48);
    // The panel gets shorter rather than hanging below the window, so its bottom edge stays reachable.
    const height = Math.max(MIN_H, Math.min(r.height, window.innerHeight - top - 8));
    return { width, height, top, left: Math.min(Math.max(r.left, 80 - width), window.innerWidth - 80) };
  }

  /** `edges` is "move", or any of l, r, b for the sides being dragged. */
  function startDrag(event: PointerEvent, edges: string) {
    if (event.button !== 0 || !panelEl) return;
    if (edges === 'move' && (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const box = panelEl.getBoundingClientRect();
    const from: Rect = { left: box.left, top: box.top, width: box.width, height: box.height };
    const x0 = event.clientX;
    const y0 = event.clientY;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      const next = { ...from };
      if (edges === 'move') {
        next.left += dx;
        next.top += dy;
      } else {
        if (edges.includes('r')) next.width = Math.max(MIN_W, from.width + dx);
        if (edges.includes('b')) next.height = Math.max(MIN_H, from.height + dy);
        if (edges.includes('l')) {
          next.width = Math.max(MIN_W, from.width - dx);
          next.left = from.left + from.width - next.width;
        }
      }
      rect = fit(next);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      saveRect();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }
  function resetRect() {
    rect = null;
    saveRect();
  }

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
    rereadScreen = read;
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
    answerNotice = null;
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

<svelte:window onresize={() => rect && (rect = fit(rect))} />

<aside
  aria-label="Agent details"
  bind:this={panelEl}
  class:floating={rect !== null}
  style={rect ? `left:${rect.left}px; top:${rect.top}px; width:${rect.width}px; height:${rect.height}px` : undefined}
>
 <div class="body">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="head"
    title="Drag to move · double-click to put back"
    onpointerdown={(e) => startDrag(e, 'move')}
    ondblclick={(e) => !(e.target as HTMLElement).closest('button') && resetRect()}
  >
    <span class="swatch" style:background={store.colorOf(agent)}></span>
    <div class="title">
      <h2>{agent.name}</h2>
      <p>{agent.rig} · {agent.pod} · {agent.runtime}{agent.model ? ` · ${agent.model}` : ''}</p>
    </div>
    <button class="ghost" aria-pressed={showSettings} onclick={() => (showSettings = !showSettings)}>Settings</button>
    <button class="ghost" aria-pressed={following} onclick={() => store.toggleFollow(agent.id)}>
      {following ? 'Following' : 'Follow'}
    </button>
    <button class="ghost" aria-label="Close" onclick={() => store.select(null)}>✕</button>
  </div>

  {#if showSettings}
    {#key agentId}
      <AgentSettings {store} {agent} onclose={() => (showSettings = false)} />
    {/key}
  {:else}
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

  {#if options.length > 0}
    <section class="answer" aria-label="Answer the question on screen">
      <h3>Answer {agent.name}</h3>
      <p class="muted">Pressing a choice presses that key in the agent's terminal.</p>
      {#each options as option (option.key)}
        <button class="choice" class:current={option.selected} disabled={answering} onclick={() => answer(option)}>
          <kbd>{option.key}</kbd><span>{option.label}</span>
        </button>
      {/each}
    </section>
  {/if}
  {#if answerNotice}
    <p class={answerNotice.ok ? 'muted' : 'error'} role="status">{answerNotice.text}</p>
  {/if}

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
  {/if}
 </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="grip l" onpointerdown={(e) => startDrag(e, 'l')}></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="grip r" onpointerdown={(e) => startDrag(e, 'r')}></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="grip b" onpointerdown={(e) => startDrag(e, 'b')}></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="grip bl" onpointerdown={(e) => startDrag(e, 'lb')}></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="grip br" title="Drag to resize" onpointerdown={(e) => startDrag(e, 'rb')}></div>
</aside>

<style>
  aside {
    position: absolute;
    top: 70px;
    right: 12px;
    bottom: 12px;
    width: min(400px, calc(100vw - 24px));
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  aside.floating {
    right: auto;
    bottom: auto;
  }
  .body {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    overflow-y: auto;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: move;
    user-select: none;
    touch-action: none;
  }
  .grip {
    position: absolute;
    touch-action: none;
  }
  .grip.l,
  .grip.r {
    top: 12px;
    bottom: 12px;
    width: 8px;
    cursor: ew-resize;
  }
  .grip.l {
    left: -4px;
  }
  .grip.r {
    right: -4px;
  }
  .grip.b {
    left: 12px;
    right: 12px;
    bottom: -4px;
    height: 8px;
    cursor: ns-resize;
  }
  .grip.bl,
  .grip.br {
    bottom: -4px;
    width: 16px;
    height: 16px;
  }
  .grip.bl {
    left: -4px;
    cursor: nesw-resize;
  }
  .grip.br {
    right: -4px;
    cursor: nwse-resize;
    border-right: 2px solid var(--muted);
    border-bottom: 2px solid var(--muted);
    border-bottom-right-radius: 12px;
    opacity: 0.6;
  }
  .answer {
    display: grid;
    gap: 6px;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid var(--accent);
  }
  .answer h3 {
    margin: 0;
    color: var(--text);
  }
  .choice {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: var(--text);
    text-align: left;
    overflow-wrap: anywhere;
  }
  .choice:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .choice.current {
    border-color: var(--accent);
  }
  .choice:disabled {
    opacity: 0.5;
    cursor: default;
  }
  kbd {
    flex: none;
    min-width: 20px;
    padding: 0 5px;
    border-radius: 5px;
    background: var(--border);
    font: 600 12px ui-monospace, Menlo, Consolas, monospace;
    text-align: center;
  }
  @media (max-width: 720px) {
    aside.floating {
      left: 12px !important;
      top: 70px !important;
      width: auto !important;
      height: auto !important;
      right: 12px;
      bottom: 12px;
    }
    .grip {
      display: none;
    }
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
