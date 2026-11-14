<script lang="ts">
  import { T, useTask, useThrelte } from '@threlte/core';
  import { HTML, interactivity, OrbitControls } from '@threlte/extras';
  import { desksForZone, isLead } from '@backoffice/core';
  import * as THREE from 'three';
  import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
  import type { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import type { OfficeStore } from '../state/office.svelte.ts';
  import AgentCharacter from './AgentCharacter.svelte';
  import { MONITOR } from './build/furniture.ts';
  import { buildLights, buildOffice } from './build/office.ts';
  import { disposeMaterials, makeMaterials } from './build/kit.ts';
  import PostFx from './PostFx.svelte';

  let { store }: { store: OfficeStore } = $props();

  interactivity();
  const { scene, renderer, size, invalidate } = useThrelte();

  // The whole look hangs off the theme: new theme, new materials, new building, new light.
  const mats = $derived(makeMaterials(store.theme));
  const office = $derived(buildOffice(store.layout, store.theme, mats));
  const lights = $derived(buildLights(store.theme, store.layout));
  $effect(() => {
    const old = mats;
    return () => disposeMaterials(old);
  });

  const desks = $derived(store.layout.zones.flatMap(desksForZone));
  const SCREEN = new THREE.PlaneGeometry(MONITOR.w, MONITOR.h);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomLight = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  $effect(() => {
    scene.environment = roomLight;
    scene.environmentIntensity = store.theme.lighting.environment;
    scene.background = new THREE.Color(store.theme.background);
    invalidate();
  });

  let camera = $state<THREE.OrthographicCamera>();
  let controls = $state<ThreeOrbitControls>();

  // Frame the whole office once, whatever the window size.
  let framed = false;
  $effect(() => {
    if (framed || !camera || $size.width === 0) return;
    framed = true;
    camera.zoom = Math.min(Math.max(Math.min($size.width / 46, $size.height / 29), 6), 60);
    camera.updateProjectionMatrix();
  });

  const goal = new THREE.Vector3();
  const step = new THREE.Vector3();
  let followedFor = 0;
  let lastFollow: string | null = null;
  useTask((delta) => {
    const id = store.followId;
    if (id !== lastFollow) {
      lastFollow = id;
      followedFor = 0;
    }
    const seat = id ? (store.live.get(id) ?? store.seats.get(id)) : undefined;
    if (!seat || !camera || !controls) return;
    followedFor += delta;
    const ease = 1 - Math.exp(-delta * 4);
    step.copy(goal.set(seat.x, 0.8, seat.z)).sub(controls.target).multiplyScalar(ease);
    controls.target.add(step);
    camera.position.add(step);
    // Move in close when the follow starts, then leave the zoom to the person.
    if (followedFor < 1.5 && camera.zoom < 44) {
      camera.zoom += (44 - camera.zoom) * ease;
      camera.updateProjectionMatrix();
    }
  });
</script>

<T.OrthographicCamera makeDefault bind:ref={camera} position={[38, 34, 40]} near={0.1} far={500}>
  <OrbitControls
    bind:ref={controls}
    target={[0, 0, 1]}
    enableDamping
    dampingFactor={0.12}
    minZoom={5}
    maxZoom={140}
    minPolarAngle={0.2}
    maxPolarAngle={1.4}
    screenSpacePanning={false}
    mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
    touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
    onstart={() => (store.followId = null)}
  />
</T.OrthographicCamera>

<T is={lights} />
<T is={office} />
<PostFx theme={store.theme} />

{#each store.layout.rooms as room (room.id)}
  <HTML position={[room.x + room.w / 2, 0.02, room.z + room.d - 0.7]} center pointerEvents="none" zIndexRange={[5, 0]}>
    <div class="label">{room.name}</div>
  </HTML>
{/each}

{#each store.layout.zones as zone (zone.id)}
  {@const pods = store.zoneLabels.get(zone.id)}
  {#if pods && !store.layout.rooms.some((r) => r.id === zone.id)}
    <HTML position={[zone.x, 0.02, zone.z + 2.35]} center pointerEvents="none" zIndexRange={[5, 0]}>
      <div class="label">{pods.join(' · ')}</div>
    </HTML>
  {/if}
{/each}

<!-- A desk's screen is lit only while its owner is working at it. -->
{#each desks as desk (desk.id)}
  {#if store.litDesks.has(desk.id)}
    <T.Mesh
      geometry={SCREEN}
      material={mats.screenOn}
      position={[
        desk.x + Math.sin(desk.rot) * (MONITOR.z + 0.002),
        MONITOR.y + MONITOR.h / 2,
        desk.z + Math.cos(desk.rot) * (MONITOR.z + 0.002),
      ]}
      rotation.y={desk.rot}
    />
  {/if}
{/each}

{#each store.snapshot.agents as agent (agent.id)}
  {@const seat = store.seats.get(agent.id)}
  {#if seat}
    <AgentCharacter
      {agent}
      {seat}
      {mats}
      layout={store.layout}
      live={store.live}
      lead={isLead(agent)}
      theme={store.theme}
      color={store.colorOf(agent)}
      selected={store.selectedId === agent.id}
      onselect={() => store.select(agent.id)}
    />
  {/if}
{/each}

<style>
  .label {
    font: 700 10px/1 system-ui, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
    user-select: none;
    opacity: 0.85;
  }
</style>
