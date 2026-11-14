<script lang="ts">
  import { reasonLabel } from '@backoffice/core';
  import type { OfficeStore } from '../state/office.svelte.ts';

  let { store }: { store: OfficeStore } = $props();

  const LABEL = { working: 'Working', idle: 'Idle', 'needs-input': 'Needs you', unknown: 'Unknown' } as const;
</script>

<nav aria-label="Agents">
  {#if store.agents.length === 0}
    <p class="empty">{store.snapshot.health.message ?? 'No agents are running.'}</p>
  {/if}
  <ul>
    {#each store.agents as agent (agent.id)}
      <li>
        <button
          class:selected={store.selectedId === agent.id}
          onclick={() => {
            store.select(agent.id);
            store.followId = agent.id;
          }}
        >
          <span class="swatch" style:background={store.colorOf(agent)}></span>
          <span class="who">
            <span class="name">{agent.name}</span>
            <span class="where">{agent.rig} · {agent.pod}</span>
          </span>
          <span class="status" style:color={agent.status === 'needs-input' ? store.theme.status['needs-input'] : undefined}>
            <i style:background={store.theme.status[agent.status]}></i>
            {agent.status === 'needs-input' ? (reasonLabel(agent.statusReason) ?? LABEL[agent.status]) : LABEL[agent.status]}
          </span>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  nav {
    position: absolute;
    top: 70px;
    left: 12px;
    bottom: 12px;
    width: 250px;
    overflow-y: auto;
    padding: 6px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button {
    width: 100%;
    display: grid;
    grid-template-columns: 6px 1fr;
    grid-template-rows: auto auto;
    column-gap: 10px;
    padding: 7px 8px;
    border: 0;
    border-radius: 8px;
    background: none;
    text-align: left;
  }
  button:hover {
    background: var(--border);
  }
  button.selected {
    background: var(--border);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .swatch {
    grid-row: 1 / 3;
    border-radius: 3px;
  }
  .who {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .where {
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 12px;
  }
  i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
  }
  .empty {
    margin: 10px;
    color: var(--muted);
  }
  @media (max-width: 720px) {
    nav {
      top: auto;
      right: 12px;
      width: auto;
      max-height: 34vh;
    }
  }
</style>
