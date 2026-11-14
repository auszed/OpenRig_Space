<script lang="ts">
  import { isOpenTask } from '@backoffice/core';
  import type { OfficeStore } from '../state/office.svelte.ts';
  import ViewSettings from './ViewSettings.svelte';

  let { store }: { store: OfficeStore } = $props();

  const open = $derived(store.snapshot.queue.filter((q) => isOpenTask(q.state)).length);
  const working = $derived(store.snapshot.agents.filter((a) => a.status === 'working').length);
  const problem = $derived(
    !store.connected ? 'Reconnecting to the office server…' : store.snapshot.health.ok ? null : store.snapshot.health.message,
  );
</script>

<header>
  <strong>Backoffice Agents</strong>
  <span class="stat">{store.snapshot.agents.length} agents</span>
  <span class="stat"><i style:background={store.theme.status.working}></i>{working} working</span>
  <span class="stat" class:alert={store.waiting > 0}>
    <i style:background={store.theme.status['needs-input']}></i>{store.waiting} waiting for you
  </span>
  <button class="board" aria-pressed={store.boardOpen} onclick={() => (store.boardOpen = !store.boardOpen)}>
    Task board{#if open}<span>{open}</span>{/if}
  </button>
  {#if problem}
    <span class="problem" role="status">{problem}</span>
  {/if}
  <ViewSettings {store} />
</header>

<style>
  .board {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 13px;
    white-space: nowrap;
  }
  .board[aria-pressed='true'] {
    border-color: var(--accent);
  }
  .board span {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 11px;
    font-weight: 700;
  }
  header {
    /* Above the task board, so its view settings can be changed while the board is open. */
    z-index: 6 !important;
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 14px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    flex-wrap: wrap;
  }
  strong {
    font-size: 15px;
  }
  .stat {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .stat.alert {
    color: var(--text);
    font-weight: 600;
  }
  i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .problem {
    padding: 2px 10px;
    border-radius: 999px;
    background: #b42318;
    color: #fff;
    font-size: 12px;
    max-width: 40ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
