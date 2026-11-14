<script lang="ts" module>
  import * as THREE from 'three';

  // Shared by every character.
  const BODY = new THREE.CapsuleGeometry(0.17, 0.34, 6, 14);
  const HEAD = new THREE.SphereGeometry(0.15, 20, 16);
  const HAIR = new THREE.SphereGeometry(0.158, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const ARM = new THREE.CapsuleGeometry(0.05, 0.3, 4, 8);
  const HIT = new THREE.BoxGeometry(0.9, 1.7, 0.9);
  const RING = new THREE.RingGeometry(0.5, 0.62, 40);
  const SCREEN = new THREE.PlaneGeometry(1, 1);
  const UNSEEN = new THREE.MeshBasicMaterial({ visible: false });
</script>

<script lang="ts">
  import { behaviorFor, SEAT_OFFSET, type Agent, type OfficeTheme, type Seat } from '@backoffice/core';
  import { T, useTask } from '@threlte/core';
  import { HTML } from '@threlte/extras';
  import { MONITOR } from './build/furniture.ts';
  import type { Materials } from './build/kit.ts';

  interface Props {
    agent: Agent;
    seat: Seat;
    theme: OfficeTheme<unknown>;
    mats: Materials;
    color: string;
    selected: boolean;
    onselect: () => void;
  }
  let { agent, seat, theme, mats, color, selected, onselect }: Props = $props();

  const behavior = $derived(behaviorFor(agent));
  const seated = $derived(seat.deskId !== null);
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

  let time = $state(Math.random() * 10);
  useTask((delta) => {
    time += delta;
  });

  const typing = $derived(behavior.pose === 'typing');
  const bob = $derived(typing ? Math.sin(time * 9) * 0.012 : Math.sin(time * 1.3) * 0.004);
  const armSwing = $derived(typing ? Math.sin(time * 14) * 0.12 : 0);
  const pulse = $derived(behavior.pose === 'alert' ? 0.55 + Math.sin(time * 5) * 0.35 : selected ? 0.9 : 0);
  const base = $derived(seated ? 0 : 0.22);
</script>

<T.Group position={[seat.x, 0, seat.z]} rotation.y={seat.rot}>
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
        position={[side * 0.2, 0.86 + (side > 0 ? armSwing : -armSwing) * 0.15, seated ? -0.2 : -0.02]}
        rotation.x={seated ? -1.15 : 0}
        castShadow
      />
    {/each}
  </T.Group>

  {#if pulse > 0}
    <T.Mesh geometry={RING} material={ring} rotation.x={-Math.PI / 2} position.y={0.03} material.opacity={pulse} />
  {/if}

  {#if seated && behavior.screenOn}
    <T.Mesh
      geometry={SCREEN}
      material={mats.screenOn}
      scale={[MONITOR.w, MONITOR.h, 1]}
      position={[0, MONITOR.y + MONITOR.h / 2, -SEAT_OFFSET + MONITOR.z + 0.002]}
    />
  {/if}

  <HTML position.y={base + 1.62} center pointerEvents="none" zIndexRange={[20, 0]}>
    <div class="tag" class:selected class:away>
      {#if behavior.bubble}
        <div class="bubble" style:background={statusColor}>{behavior.bubble}</div>
      {/if}
      <div class="name"><span class="dot" style:background={statusColor}></span>{agent.name}</div>
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
