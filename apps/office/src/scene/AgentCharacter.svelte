<script lang="ts" module>
  import * as THREE from 'three';

  // Shared by every character.
  const BODY = new THREE.CapsuleGeometry(0.17, 0.34, 6, 14);
  const HEAD = new THREE.SphereGeometry(0.15, 20, 16);
  const HAIR = new THREE.SphereGeometry(0.158, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const ARM = new THREE.CapsuleGeometry(0.05, 0.3, 4, 8);
  const HIT = new THREE.BoxGeometry(0.9, 1.7, 0.9);
  const RING = new THREE.RingGeometry(0.5, 0.62, 40);
  /** Metres per second. */
  const WALK = 3.2;
  const UNSEEN = new THREE.MeshBasicMaterial({ visible: false });
</script>

<script lang="ts">
  import { behaviorFor, route, type Agent, type Layout, type OfficeTheme, type Seat } from '@backoffice/core';
  import { T, useTask } from '@threlte/core';
  import { HTML } from '@threlte/extras';
  import type { Materials } from './build/kit.ts';

  interface Props {
    agent: Agent;
    seat: Seat;
    theme: OfficeTheme<unknown>;
    mats: Materials;
    color: string;
    selected: boolean;
    lead: boolean;
    layout: Layout;
    /** Shared record of where each character is drawn, for the camera to follow. */
    live: Map<string, { x: number; z: number }>;
    onselect: () => void;
  }
  let { agent, seat, theme, mats, color, selected, lead, layout, live, onselect }: Props = $props();

  const behavior = $derived(behaviorFor(agent));
  const away = $derived(behavior.pose === 'away');
  const statusColor = $derived(theme.status[agent.status]);

  const shirt = $derived(new THREE.MeshStandardMaterial({ color: away ? '#9aa1ab' : color, roughness: 0.75 }));
  const ring = $derived(new THREE.MeshBasicMaterial({ color: selected ? theme.ui.accent : statusColor, transparent: true, side: THREE.DoubleSide }));
  $effect(() => {
    const [a, b] = [shirt, ring];
    return () => {
      a.dispose();
      b.dispose();
    };
  });

  // The character walks to wherever its seat is; it starts out already sitting there.
  // svelte-ignore state_referenced_locally
  let x = $state(seat.x);
  // svelte-ignore state_referenced_locally
  let z = $state(seat.z);
  // svelte-ignore state_referenced_locally
  let rot = $state(seat.rot);
  let path: Array<{ x: number; z: number }> = [];
  let walking = $state(false);
  // svelte-ignore state_referenced_locally
  let target = `${seat.x},${seat.z}`;
  $effect(() => {
    const next = `${seat.x},${seat.z}`;
    if (next === target) return;
    target = next;
    path = route({ x, z }, seat, layout);
    walking = true;
  });
  $effect(() => {
    const id = agent.id;
    return () => live.delete(id);
  });

  /**
   * The name tag handles its own presses with plain listeners. Svelte's `onclick` never reaches
   * it: the tag is moved next to the 3D canvas, and the canvas's own listeners grab the pointer
   * (camera controls) and turn the click into a pick of whatever character is behind the tag.
   */
  function pickOnClick(node: HTMLElement, pick: () => void) {
    let current = pick;
    const keep = (e: Event) => e.stopPropagation();
    const click = (e: Event) => {
      e.stopPropagation();
      current();
    };
    node.addEventListener('pointerdown', keep);
    node.addEventListener('click', click);
    return {
      update: (next: () => void) => (current = next),
      destroy: () => {
        node.removeEventListener('pointerdown', keep);
        node.removeEventListener('click', click);
      },
    };
  }

  const turn = (to: number, amount: number) => {
    const diff = Math.atan2(Math.sin(to - rot), Math.cos(to - rot));
    rot += diff * amount;
  };

  let time = $state(Math.random() * 10);
  useTask((delta) => {
    time += delta;
    let left = WALK * delta;
    while (walking && left > 0) {
      const next = path[0];
      if (!next) {
        walking = false;
        break;
      }
      const [dx, dz] = [next.x - x, next.z - z];
      const dist = Math.hypot(dx, dz);
      if (dist <= left) {
        x = next.x;
        z = next.z;
        left -= dist;
        path.shift();
      } else {
        x += (dx / dist) * left;
        z += (dz / dist) * left;
        // A character looks along its own -z.
        turn(Math.atan2(-dx, -dz), Math.min(1, delta * 12));
        left = 0;
      }
    }
    if (!walking && rot !== seat.rot) turn(seat.rot, Math.abs(seat.rot - rot) < 0.01 ? 1 : Math.min(1, delta * 10));
    live.set(agent.id, { x, z });
  });

  const posture = $derived(walking ? 'stand' : seat.posture);
  const seated = $derived(posture !== 'stand');
  const atDesk = $derived(posture === 'desk');
  const typing = $derived(atDesk && behavior.pose === 'typing');
  const bob = $derived(
    walking ? Math.abs(Math.sin(time * 11)) * 0.035 : typing ? Math.sin(time * 9) * 0.012 : Math.sin(time * 1.3) * 0.004,
  );
  const armSwing = $derived(walking ? Math.sin(time * 11) * 0.5 : typing ? Math.sin(time * 14) * 0.12 : 0);
  const pulse = $derived(behavior.pose === 'alert' ? 0.55 + Math.sin(time * 5) * 0.35 : selected ? 0.9 : 0);
  // A sofa is lower than a chair; with no chair at all the body stands tall.
  const base = $derived(posture === 'stand' ? 0.22 : posture === 'sofa' ? -0.06 : 0);
</script>

<T.Group position={[x, 0, z]} rotation.y={rot}>
  <T.Mesh
    geometry={HIT}
    material={UNSEEN}
    position.y={0.85}
    onclick={(event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      onselect();
    }}
    onpointerenter={() => (document.body.style.cursor = 'pointer')}
    onpointerleave={() => (document.body.style.cursor = '')}
  />

  <T.Group position.y={base + bob}>
    <T.Mesh geometry={BODY} material={shirt} position.y={0.8} castShadow />
    <T.Mesh geometry={HEAD} material={mats.skin} position.y={1.24} castShadow />
    <T.Mesh geometry={HAIR} material={mats.hair} position.y={1.25} />
    {#each [-1, 1] as side (side)}
      <T.Mesh
        geometry={ARM}
        material={shirt}
        position={[side * 0.2, 0.86 + (walking ? 0 : (side > 0 ? armSwing : -armSwing) * 0.15), atDesk ? -0.2 : seated ? -0.1 : -0.02]}
        rotation.x={atDesk ? -1.15 : seated ? -0.55 : walking ? side * armSwing : 0}
        castShadow
      />
    {/each}
  </T.Group>

  {#if pulse > 0}
    <T.Mesh geometry={RING} material={ring} rotation.x={-Math.PI / 2} position.y={0.03} material.opacity={pulse} />
  {/if}

  <HTML position.y={base + 1.62} center pointerEvents="none" zIndexRange={[20, 0]}>
    <div class="tag" class:selected class:away>
      {#if behavior.bubble}
        <div class="bubble" style:background={statusColor}>{behavior.bubble}</div>
      {/if}
      <button type="button" class="name" use:pickOnClick={onselect}><span class="dot" style:background={statusColor}></span>{agent.name}{#if lead}<span class="lead" title="Team lead">★</span>{/if}</button>
    </div>
  </HTML>
</T.Group>

<style>
  .tag {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    transform: translateY(-50%);
    font: 600 10px/1.2 system-ui, sans-serif;
    white-space: nowrap;
    user-select: none;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    font: inherit;
    cursor: pointer;
    /* The tag as a whole lets clicks through to the scene; only the name catches them. */
    pointer-events: auto;
    border-radius: 999px;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  }
  .selected .name {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .away .name {
    opacity: 0.6;
  }
  .lead {
    color: var(--accent);
    font-size: 11px;
    line-height: 1;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .bubble {
    padding: 4px 9px;
    border-radius: 8px;
    color: #fff;
    font-weight: 700;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
    animation: nudge 1.2s ease-in-out infinite;
  }
  @keyframes nudge {
    50% {
      transform: translateY(-3px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bubble {
      animation: none;
    }
  }
</style>
