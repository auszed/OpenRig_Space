<script lang="ts">
  import { Canvas } from '@threlte/core';
  import * as THREE from 'three';
  import Scene from './scene/Scene.svelte';
  import { OfficeStore } from './state/office.svelte.ts';
  import AgentList from './ui/AgentList.svelte';
  import AgentPanel from './ui/AgentPanel.svelte';
  import TopBar from './ui/TopBar.svelte';

  const store = new OfficeStore();
  $effect(() => {
    store.connect();
    return () => store.disconnect();
  });

  const cssVars = $derived(Object.entries(store.theme.ui).map(([k, v]) => `--${k}: ${v}`).join('; '));
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && store.select(null)} />

<div class="office" style={cssVars}>
  <div class="stage">
    <!-- Tone mapping is done in the post-processing chain, so the renderer's own is off. -->
    <Canvas toneMapping={THREE.NoToneMapping} dpr={Math.min(window.devicePixelRatio, 1.5)}>
      <Scene {store} />
    </Canvas>
  </div>

  <TopBar {store} />
  <AgentList {store} />
  {#if store.selected}
    <AgentPanel {store} agent={store.selected} />
  {/if}

  <p class="hint">Drag to move · scroll to zoom · right-drag to turn · click an agent</p>
</div>

<style>
  .office {
    position: fixed;
    inset: 0;
    color: var(--text);
  }
  /* Its own layer, so name tags drawn over the 3D view stay underneath the panels. */
  .stage {
    position: absolute;
    inset: 0;
    z-index: 0;
  }
  .office > :global(:not(.stage)) {
    z-index: 1;
  }
  .hint {
    position: absolute;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    margin: 0;
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
  }
  @media (max-width: 720px) {
    .hint {
      display: none;
    }
  }
</style>
