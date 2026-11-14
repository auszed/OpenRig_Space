<script lang="ts">
  import type { OfficeStore } from '../state/office.svelte.ts';
  import { themes } from '../themes.ts';

  let { store }: { store: OfficeStore } = $props();

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
  {#if problem}
    <span class="problem" role="status">{problem}</span>
  {/if}
  <label>
    Look
    <select value={store.themeId} onchange={(e) => store.setTheme(e.currentTarget.value)}>
      {#each themes as theme (theme.id)}
        <option value={theme.id}>{theme.name}</option>
      {/each}
    </select>
  </label>
</header>

<style>
  header {
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
  label {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }
  select {
    padding: 4px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: var(--text);
  }
</style>
