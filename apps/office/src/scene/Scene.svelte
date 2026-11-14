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

  // --- Neon walkways (themes with `walkways`) -------------------------------------------------
  const NEON_WIDTH = 0.06;
  const neon = $derived.by(() => {
    const style = store.theme.walkways;
    if (!style) return null;
    const material = new THREE.MeshStandardMaterial({
      color: '#0b0d12',
      roughness: 0.5,
      emissive: style.color,
      emissiveIntensity: style.intensity,
    });
    // The light the neon throws on the floor: a wide strip that fades out to both sides, added
    // on top of the floor so it tints it. Brighter where strips cross, as real light would be.
    const spill = style.spill ?? 0;
    const spillWidth = style.spillWidth ?? 1.4;
    const halo = spill > 0
      ? new THREE.MeshBasicMaterial({
          color: style.color,
          map: fadeAcross(),
          transparent: true,
          opacity: spill,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
      : null;
    const group = new THREE.Group();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (const w of store.layout.walkways) {
      const length = Math.hypot(w.x2 - w.x1, w.z2 - w.z1) + NEON_WIDTH;
      const alongX = Math.abs(w.z2 - w.z1) < 1e-6;
      const strip = new THREE.Mesh(box, material);
      strip.scale.set(alongX ? length : NEON_WIDTH, 0.008, alongX ? NEON_WIDTH : length);
      strip.position.set((w.x1 + w.x2) / 2, 0.018, (w.z1 + w.z2) / 2);
      group.add(strip);
      if (halo) {
        const tint = new THREE.Mesh(plane, halo);
        // The texture fades across its width (u), so a strip along z is turned a quarter.
        tint.scale.set(length + spillWidth * 0.3, 1, spillWidth);
        if (!alongX) tint.rotation.y = Math.PI / 2;
        tint.position.set((w.x1 + w.x2) / 2, 0.012, (w.z1 + w.z2) / 2);
        tint.renderOrder = 1;
        group.add(tint);
      }
    }
    return { group, material, halo, box, plane, intensity: style.intensity, spill };
  });
  // The View menu's sliders change brightness in place, without rebuilding the strips.
  $effect(() => {
    if (!neon) return;
    neon.material.emissiveIntensity = neon.intensity * store.glowLevels.lines;
    if (neon.halo) neon.halo.opacity = Math.min(1, neon.spill * store.glowLevels.floor);
    invalidate();
  });
  $effect(() => {
    const old = neon;
    return () => {
      old?.material.dispose();
      old?.halo?.map?.dispose();
      old?.halo?.dispose();
      old?.box.dispose();
      old?.plane.dispose();
    };
  });
  /** A small texture bright along its middle line and fading to nothing at its top and bottom edges. */
  function fadeAcross(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const fade = ctx.createLinearGradient(0, 0, 0, 64);
    fade.addColorStop(0, 'rgba(255,255,255,0)');
    fade.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    fade.addColorStop(0.5, 'rgba(255,255,255,1)');
    fade.addColorStop(0.65, 'rgba(255,255,255,0.35)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 4, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  // --- Screens that light the room (themes with `lighting.screenGlow`) -----------------------
  const glow = $derived(store.theme.lighting.screenGlow ?? null);
  /** One glowing screen material per colour; desk screens take them in turn. */
  const glowMats = $derived(
    (glow?.colors ?? []).map(
      (color) =>
        new THREE.MeshStandardMaterial({
          color: '#0b0d12',
          roughness: 0.4,
          emissive: color,
          emissiveIntensity: store.theme.materials.screenOn.emissiveIntensity ?? 2,
        }),
    ),
  );
  $effect(() => {
    const old = glowMats;
    return () => old.forEach((m) => m.dispose());
  });
  $effect(() => {
    const base = store.theme.materials.screenOn.emissiveIntensity ?? 2;
    for (const m of glowMats) m.emissiveIntensity = base * store.glowLevels.screens;
    invalidate();
  });
  const screenMat = (index: number) => glowMats[index % Math.max(glowMats.length, 1)] ?? mats.screenOn;

  /**
   * A fixed pool of lights, always in the scene. three.js recompiles every material when the
   * number of lights changes, so lights are switched by intensity rather than added and removed.
   * Beyond the pool, screens still glow but cast no light.
   */
  const POOL = 16;
  const pool = Array.from({ length: POOL }, () => {
    const light = new THREE.PointLight('#ffffff', 0, 4, 2);
    light.castShadow = false;
    return light;
  });
  interface Glow { x: number; y: number; z: number; color: string; strength: number }
  const glows = $derived.by((): Glow[] => {
    if (!glow) return [];
    // Wall screens hang on a back wall and face +z; their light falls into the room in front.
    const walls = store.layout.furniture
      .filter((f) => f.kind === 'screenWall')
      .map((f) => ({ x: f.x, y: 1.5, z: f.z + 1.1, color: glow.colors[0]!, strength: 1.6 }));
    const lit = desks.flatMap((desk, i) =>
      store.litDesks.has(desk.id)
        ? [{
            // Just in front of the monitor, towards whoever sits at the desk.
            x: desk.x + Math.sin(desk.rot) * (MONITOR.z + 0.4),
            y: MONITOR.y + 0.2,
            z: desk.z + Math.cos(desk.rot) * (MONITOR.z + 0.4),
            color: glow.colors[i % glow.colors.length]!,
            strength: 1,
          }]
        : [],
    );
    return [...walls, ...lit].slice(0, POOL);
  });
  $effect(() => {
    pool.forEach((light, i) => {
      const g = glows[i];
      light.intensity = g && glow ? glow.intensity * g.strength * store.glowLevels.screens : 0;
      light.distance = glow?.distance ?? 4;
      if (g) {
        light.position.set(g.x, g.y, g.z);
        light.color.set(g.color);
      }
      light.userData.base = light.intensity;
    });
    invalidate();
  });
  // A slow, slight flicker, different for each light, so the room feels lived in.
  let clock = 0;
  useTask((delta) => {
    if (!glow) return;
    clock += delta;
    pool.forEach((light, i) => {
      const base = (light.userData.base as number) ?? 0;
      if (base > 0) light.intensity = base * (1 + 0.06 * Math.sin(clock * (1.3 + (i % 5) * 0.37) + i * 2.1));
    });
  });

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

  // Frame the whole office, whatever the window size; again whenever the building grows or shrinks.
  let framedFor = '';
  $effect(() => {
    const { width, depth } = store.layout;
    const key = `${width}x${depth}`;
    if (framedFor === key || !camera || $size.width === 0) return;
    framedFor = key;
    camera.zoom = Math.min(Math.max(Math.min($size.width / (width + 10), $size.height / (depth + 1)), 5), 60);
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
{#if glow}
  {#each pool as light, i (i)}<T is={light} />{/each}
{/if}
<T is={office} />
{#if neon}<T is={neon.group} />{/if}
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
{#each desks as desk, i (desk.id)}
  {#if store.litDesks.has(desk.id)}
    <T.Mesh
      geometry={SCREEN}
      material={screenMat(i)}
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
    color: var(--label, var(--muted));
    white-space: nowrap;
    user-select: none;
    opacity: 0.85;
  }
</style>
