import { DESK_WIDTH, desksForZone, type FurnitureItem, type Layout, type OfficeTheme, type Wall } from '@backoffice/core';
import * as THREE from 'three';
import { buildExterior } from './exterior.ts';
import { defaultFurniture } from './furniture.ts';
import { Kit, type FurnitureBuilder, type Materials } from './kit.ts';

const DOOR = 1.5;
const DOOR_HEIGHT = 2.1;

function wallPiece(kit: Kit, wall: Wall, from: number, to: number): THREE.Object3D[] {
  const len = to - from;
  if (len <= 0.01) return [];
  const mid = (from + to) / 2;
  const h = wall.height;
  if (wall.kind === 'solid') return [kit.box('wall', len, h, 0.14, mid, 0, 0)];
  const parts: THREE.Object3D[] = [
    kit.box('glass', len, h - 0.12, 0.03, mid, 0.06, 0),
    kit.box('frame', len, 0.06, 0.08, mid, 0, 0),
    kit.box('frame', len, 0.06, 0.08, mid, h - 0.06, 0),
  ];
  const posts = Math.max(1, Math.round(len / 1.8));
  for (let i = 0; i <= posts; i++) parts.push(kit.box('frame', 0.06, h, 0.08, from + (len * i) / posts, 0, 0));
  return parts;
}

function buildWall(kit: Kit, wall: Wall): THREE.Group {
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const length = Math.hypot(dx, dz);
  const g = kit.group();
  if (wall.door === undefined) {
    g.add(...wallPiece(kit, wall, 0, length));
  } else {
    const centre = length * wall.door;
    const a = Math.max(0, centre - DOOR / 2);
    const b = Math.min(length, centre + DOOR / 2);
    g.add(...wallPiece(kit, wall, 0, a), ...wallPiece(kit, wall, b, length));
    // The stretch above the doorway.
    g.add(kit.box(wall.kind === 'solid' ? 'wall' : 'frame', b - a, wall.height - DOOR_HEIGHT, wall.kind === 'solid' ? 0.14 : 0.08, (a + b) / 2, DOOR_HEIGHT, 0));
  }
  g.position.set(wall.x1, 0, wall.z1);
  g.rotation.y = Math.atan2(-dz, dx);
  return g;
}

/**
 * Turns a layout into geometry, painted with the theme's materials. Agents are
 * not part of this: they change every few seconds, the building does not.
 */
export function buildOffice(layout: Layout, theme: OfficeTheme<FurnitureBuilder>, mats: Materials): THREE.Group {
  const kit = new Kit(mats);
  const office = kit.group();
  const furniture = { ...defaultFurniture, ...theme.furniture };

  const place = (item: FurnitureItem) => {
    const object = furniture[item.kind](kit, item);
    const holder = kit.group(object);
    holder.position.set(item.x, 0, item.z);
    holder.rotation.y = item.rot ?? 0;
    office.add(holder);
  };

  office.add(kit.box('floor', layout.width, 0.04, layout.depth, 0, -0.04, 0));
  for (const room of layout.rooms) {
    if (room.floor !== 'floor') {
      office.add(kit.box(room.floor, room.w - 0.1, 0.012, room.d - 0.1, room.x + room.w / 2, 0, room.z + room.d / 2));
    }
  }
  for (const wall of layout.walls) office.add(buildWall(kit, wall));

  for (const zone of layout.zones) {
    const perRow = Math.ceil(zone.seats / 2);
    const benchWidth = perRow * DESK_WIDTH;
    const inRoom = layout.rooms.some((r) => zone.x > r.x && zone.x < r.x + r.w && zone.z > r.z && zone.z < r.z + r.d);
    if (!inRoom) office.add(kit.box('carpet', benchWidth + 3, 0.012, 5.4, zone.x, 0, zone.z));
    for (const desk of desksForZone(zone)) place({ kind: 'desk', x: desk.x, z: desk.z, rot: desk.rot });
    place({ kind: 'benchDivider', x: zone.x, z: zone.z, w: benchWidth - 0.1 });
  }
  for (const item of layout.furniture) place(item);

  // Framed prints on the long left wall, where no room hides it.
  const leftWall = -layout.width / 2 + 0.09;
  for (const [z, slot] of [[7, 'accent'], [9.2, 'dark'], [11.4, 'accent']] as const) {
    office.add(kit.box('dark', 0.03, 1.5, 1.2, leftWall, 0.9, z), kit.box(slot, 0.03, 1.3, 1.0, leftWall + 0.02, 1.0, z));
  }

  office.add(buildExterior(kit, layout));
  return office;
}

/** Sun, sky fill and their shadow settings, sized to cover the whole floor plan. */
export function buildLights(theme: OfficeTheme<unknown>, layout: Layout): THREE.Group {
  const { sun, sky } = theme.lighting;
  const lights = new THREE.Group();
  lights.add(new THREE.HemisphereLight(sky.color, sky.ground, sky.intensity));

  const key = new THREE.DirectionalLight(sun.color, sun.intensity);
  key.position.set(...sun.position);
  key.castShadow = true;
  const reach = Math.max(layout.width, layout.depth) * 0.9;
  const cam = key.shadow.camera;
  cam.left = -reach;
  cam.right = reach;
  cam.top = reach;
  cam.bottom = -reach;
  cam.near = 1;
  cam.far = 140;
  cam.updateProjectionMatrix();
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  lights.add(key, key.target);
  return lights;
}
