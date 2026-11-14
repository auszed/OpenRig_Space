<script lang="ts">
  import { isLead, reasonLabel, type Agent } from '@backoffice/core';
  import type { OfficeStore } from '../state/office.svelte.ts';

  let { store }: { store: OfficeStore } = $props();

  let closed = $state<Record<string, boolean>>({});

  /** What the agent is doing, in the words of where it is in the office. */
  function statusText(agent: Agent): string {
    if (agent.status === 'needs-input') return reasonLabel(agent.statusReason) ?? 'Needs you';
    if (agent.status === 'working') return 'Working';
    if (store.whereIs(agent) === 'review') return 'Waiting on PR';
    return agent.status === 'idle' ? 'Idle · in the lounge' : 'Unknown';
  }

  function tally(agents: Agent[]): string {
    const count = (s: Agent['status']) => agents.filter((a) => a.status === s).length;
    const parts = [
      [count('needs-input'), 'need you'],
      [count('working'), 'working'],
      [count('idle') + count('unknown'), 'waiting'],
    ] as const;
    return parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(' · ');
  }
</script>

<nav aria-label="Agents">
  {#if store.agents.length === 0}
    <p class="empty">{store.snapshot.health.message ?? 'No agents are running.'}</p>
  {/if}
  {#each store.teams as team (team.rig)}
    {@const open = !closed[team.rig]}
    <section>
      <button class="rig" aria-expanded={open} onclick={() => (closed[team.rig] = open)}>
        <span class="caret" class:open>▸</span>
        <span class="rig-name">{team.rig}</span>
        <span class="tally">{tally(team.pods.flatMap((p) => p.agents))}</span>
      </button>
      {#if open}
        {#each team.pods as group (group.pod)}
          <h3><span class="chip" style:background={store.colorOf(group.agents[0]!)}></span>{group.pod}</h3>
          <ul>
            {#each group.agents as agent (agent.id)}
              <li>
                <button
                  class="agent"
                  class:selected={store.selectedId === agent.id}
                  onclick={() => {
                    store.select(agent.id);
                    store.followId = agent.id;
                  }}
                >
                  <span class="swatch" style:background={store.colorOf(agent)}></span>
                  <span class="who">
                    <span class="name">{agent.name}</span>
                    {#if isLead(agent)}<span class="lead" title="Leads the {team.rig} team">★ Lead</span>{/if}
                  </span>
                  <span class="status" style:color={agent.status === 'needs-input' ? store.theme.status['needs-input'] : undefined}>
                    <i style:background={store.theme.status[agent.status]}></i>
                    {statusText(agent)}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/each}
      {/if}
    </section>
  {/each}
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
  section + section {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  button {
    width: 100%;
    border: 0;
    border-radius: 8px;
    background: none;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .rig {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 6px 8px;
  }
  .rig-name {
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .tally {
    margin-left: auto;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }
  .caret {
    color: var(--muted);
    font-size: 10px;
    transition: transform 0.12s;
  }
  .caret.open {
    transform: rotate(90deg);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 2px;
    padding: 0 8px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .chip {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  .lead {
    flex: none;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }
  .agent {
    display: grid;
    grid-template-columns: 6px 1fr;
    grid-template-rows: auto auto;
    column-gap: 10px;
    padding: 6px 8px;
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
