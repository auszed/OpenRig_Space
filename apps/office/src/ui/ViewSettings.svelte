<script lang="ts">
  import { RALLY_SECONDS, type GlowLevels, type OfficeStore } from '../state/office.svelte.ts';
  import { themes } from '../themes.ts';

  let { store }: { store: OfficeStore } = $props();

  let open = $state(false);
  let root = $state<HTMLElement>();

  /** Glow sliders, shown only for the parts this look actually lights. */
  const sliders = $derived(
    [
      { key: 'lines', label: 'Neon lines', show: !!store.theme.walkways },
      { key: 'floor', label: 'Neon on the floor', show: !!store.theme.walkways?.spill },
      { key: 'screens', label: 'Screen glow', show: !!store.theme.lighting.screenGlow },
    ].filter((s) => s.show) as Array<{ key: keyof GlowLevels; label: string }>,
  );
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

      {#if sliders.length}
        <div class="group">
          {#each sliders as slider (slider.key)}
            <label>
              <span>{slider.label} <output>{Math.round(store.glowLevels[slider.key] * 100)}%</output></span>
              <input
                type="range"
                min="0"
                max="200"
                step="10"
                value={Math.round(store.glowLevels[slider.key] * 100)}
                oninput={(e) => store.setGlow({ [slider.key]: Number(e.currentTarget.value) / 100 })}
              />
            </label>
          {/each}
          <button class="link" onclick={() => store.resetGlow()}>Reset glow</button>
        </div>
      {/if}

      <div class="group">
        {#if store.rally === 'off'}
          <button class="action" onclick={() => store.callRally()} disabled={store.home.size === 0}>Everyone to desks</button>
          <p>Everyone walks to their desk and stays {RALLY_SECONDS} seconds. Only the picture changes.</p>
        {:else}
          <button class="action" onclick={() => store.endRally()}>Send them back now</button>
          <p role="status">{store.rally === 'going' ? 'Walking to their desks…' : `Back in ${store.rallyLeft} s`}</p>
        {/if}
      </div>
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
  .group {
    display: grid;
    gap: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .action {
    padding: 7px 10px;
    border-radius: 8px;
    border: none;
    background: var(--accent);
    color: var(--accent-text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .link {
    justify-self: start;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    text-decoration: underline;
    cursor: pointer;
  }
  p {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }
</style>
