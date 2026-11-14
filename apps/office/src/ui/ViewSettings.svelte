<script lang="ts">
  import type { OfficeStore } from '../state/office.svelte.ts';
  import { themes } from '../themes.ts';

  let { store }: { store: OfficeStore } = $props();

  let open = $state(false);
  let root = $state<HTMLElement>();
</script>

<svelte:window
  onkeydown={(e) => {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      open = false;
    }
  }}
  onpointerdown={(e) => open && root && !root.contains(e.target as Node) && (open = false)}
/>

<div class="view" bind:this={root}>
  <button class="gear" aria-label="View settings" aria-expanded={open} aria-controls="view-settings" title="View settings" onclick={() => (open = !open)}>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.4h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7z"
        transform="translate(-1 0)"
      />
    </svg>
    View
  </button>

  {#if open}
    <div class="menu" id="view-settings" role="group" aria-label="View settings">
      <label>
        <span>Look</span>
        <select value={store.themeId} onchange={(e) => store.setTheme(e.currentTarget.value)}>
          {#each themes as theme (theme.id)}
            <option value={theme.id}>{theme.name}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Task board opacity <output>{Math.round(store.boardOpacity * 100)}%</output></span>
        <input
          type="range"
          min="40"
          max="100"
          step="5"
          value={Math.round(store.boardOpacity * 100)}
          oninput={(e) => store.setBoardOpacity(Number(e.currentTarget.value) / 100)}
        />
      </label>
      <p>Lower lets the office show through the board.</p>
    </div>
  {/if}
</div>

<style>
  .view {
    position: relative;
    margin-left: auto;
  }
  .gear {
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
  }
  .gear[aria-expanded='true'] {
    border-color: var(--accent);
  }
  .menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 10;
    width: 240px;
    display: grid;
    gap: 12px;
    padding: 12px;
    border-radius: 10px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  label {
    display: grid;
    gap: 6px;
  }
  label > span {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  output {
    color: var(--text);
    font-variant-numeric: tabular-nums;
    letter-spacing: normal;
  }
  select {
    width: 100%;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: var(--text);
    font: inherit;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  p {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }
</style>
