import { DESK_DEPTH, DESK_WIDTH, SEAT_OFFSET, type FurnitureKind, type MaterialSlot } from '@backoffice/core';
import type * as THREE from 'three';
import { seeded, type FurnitureBuilder, type Kit } from './kit.ts';

/** Height of a desk top, and where the monitor's glass sits relative to the desk's middle. */
export const DESK_TOP = 0.74;
export const MONITOR = { y: 0.92, z: -0.2, w: 0.56, h: 0.33 };

function chair(kit: Kit, x: number, z: number, rot = 0): THREE.Object3D {
  const g = kit.group(
    kit.cyl('dark', 0.27, 0.04, 0, 0, 0),
    kit.cyl('metal', 0.03, 0.4, 0, 0.04, 0),
    kit.box('dark', 0.46, 0.07, 0.46, 0, 0.42, 0),
    kit.box('dark', 0.44, 0.5, 0.05, 0, 0.52, 0.24),
  );
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  return g;
}

const desk: FurnitureBuilder = (kit) =>
  kit.group(
    kit.box('wood', DESK_WIDTH - 0.06, 0.05, DESK_DEPTH - 0.04, 0, DESK_TOP - 0.05, 0),
    kit.box('frame', 0.05, DESK_TOP - 0.05, DESK_DEPTH - 0.12, -(DESK_WIDTH / 2 - 0.08), 0, 0),
    kit.box('frame', 0.05, DESK_TOP - 0.05, DESK_DEPTH - 0.12, DESK_WIDTH / 2 - 0.08, 0, 0),
    kit.cyl('metal', 0.1, 0.015, 0, DESK_TOP, MONITOR.z - 0.02),
    kit.cyl('metal', 0.025, 0.2, 0, DESK_TOP, MONITOR.z - 0.04),
    kit.box('screenOff', MONITOR.w + 0.04, MONITOR.h + 0.04, 0.03, 0, MONITOR.y - 0.02, MONITOR.z - 0.016),
    kit.box('dark', 0.42, 0.015, 0.13, 0, DESK_TOP, 0.13),
    chair(kit, 0, SEAT_OFFSET),
  );

const benchDivider: FurnitureBuilder = (kit, item) =>
  kit.box('accent', item.w ?? 3, 0.4, 0.04, 0, DESK_TOP, 0);

const sofa: FurnitureBuilder = (kit) =>
  kit.group(
    kit.box('fabric', 2.2, 0.32, 0.9, 0, 0.1, 0),
    kit.box('fabric', 2.2, 0.5, 0.22, 0, 0.36, -0.34),
    kit.box('fabric', 0.22, 0.34, 0.9, -1.0, 0.3, 0),
    kit.box('fabric', 0.22, 0.34, 0.9, 1.0, 0.3, 0),
    kit.box('dark', 2.0, 0.1, 0.7, 0, 0, 0),
  );

const coffeeTable: FurnitureBuilder = (kit) =>
  kit.group(
    kit.box('white', 1.3, 0.05, 0.75, 0, 0.36, 0),
    ...[-0.55, 0.55].flatMap((x) => [-0.3, 0.3].map((z) => kit.box('metal', 0.04, 0.36, 0.04, x, 0, z))),
  );

const plant: FurnitureBuilder = (kit) =>
  kit.group(
    kit.cyl('pot', 0.24, 0.5, 0, 0, 0),
    kit.ball('plant', 0.38, 0, 0.55, 0),
    kit.ball('plant', 0.28, 0.2, 0.95, 0.1),
    kit.ball('plant', 0.26, -0.18, 1.0, -0.12),
    kit.ball('plant', 0.2, 0.02, 1.35, 0.02),
  );

const meetingTable: FurnitureBuilder = (kit) =>
  kit.group(
    kit.box('wood', 3.8, 0.06, 1.4, 0, DESK_TOP - 0.06, 0),
    kit.box('frame', 0.12, DESK_TOP - 0.06, 1.0, -1.4, 0, 0),
    kit.box('frame', 0.12, DESK_TOP - 0.06, 1.0, 1.4, 0, 0),
    ...[-1.2, 0, 1.2].flatMap((x) => [chair(kit, x, -1.1, Math.PI), chair(kit, x, 1.1)]),
  );

const whiteboard: FurnitureBuilder = (kit) =>
  kit.group(
    kit.box('metal', 3.1, 1.4, 0.02, 0, 0.95, 0),
    kit.box('white', 3.0, 1.3, 0.02, 0, 1.0, 0.02),
    kit.box('accent', 0.9, 0.03, 0.01, -0.8, 1.9, 0.035),
    kit.box('dark', 1.4, 0.03, 0.01, -0.55, 1.7, 0.035),
    kit.box('dark', 1.1, 0.03, 0.01, -0.7, 1.5, 0.035),
  );

const screenWall: FurnitureBuilder = (kit, item) => {
  const w = item.w ?? 4;
  return kit.group(
    kit.box('dark', w, 1.5, 0.06, 0, 0.85, 0),
    kit.box('screenOn', w - 0.16, 1.34, 0.02, 0, 0.93, 0.035),
  );
};

const serverRack: FurnitureBuilder = (kit) =>
  kit.group(
    kit.box('dark', 0.9, 2.0, 0.9, 0, 0, 0),
    ...[0, 1, 2, 3, 4, 5].map((i) => kit.box('screenOn', 0.66, 0.03, 0.02, 0, 0.35 + i * 0.27, 0.455)),
  );

const treadmill: FurnitureBuilder = (kit) =>
  kit.group(
    kit.box('dark', 0.75, 0.16, 1.75, 0, 0, 0),
    kit.box('rubber', 0.58, 0.02, 1.35, 0, 0.16, 0.12),
    kit.box('metal', 0.05, 1.1, 0.05, -0.33, 0.16, -0.72),
    kit.box('metal', 0.05, 1.1, 0.05, 0.33, 0.16, -0.72),
    kit.box('dark', 0.7, 0.26, 0.08, 0, 1.12, -0.72),
    kit.box('accent', 0.3, 0.12, 0.02, 0, 1.19, -0.675),
  );

const weights: FurnitureBuilder = (kit) =>
  kit.group(
    ...[0.28, 0.72].flatMap((y) => [
      kit.box('dark', 1.5, 0.05, 0.42, 0, y, 0),
      ...[-0.5, -0.17, 0.17, 0.5].map((x) => kit.box('accent', 0.24, 0.13, 0.13, x, y + 0.05, 0)),
    ]),
    kit.box('metal', 0.05, 1.0, 0.42, -0.74, 0, 0),
    kit.box('metal', 0.05, 1.0, 0.42, 0.74, 0, 0),
  );

const gymBench: FurnitureBuilder = (kit) =>
  kit.group(
    kit.box('dark', 1.5, 0.1, 0.42, 0, 0.4, 0),
    kit.box('metal', 0.06, 0.4, 0.36, -0.6, 0, 0),
    kit.box('metal', 0.06, 0.4, 0.36, 0.6, 0, 0),
  );

const locker: FurnitureBuilder = (kit) =>
  kit.group(
    kit.box('metal', 0.95, 1.9, 0.5, 0, 0, 0),
    kit.box('dark', 0.012, 1.8, 0.012, 0, 0.05, 0.252),
    kit.box('dark', 0.03, 0.16, 0.03, -0.1, 1.0, 0.262),
    kit.box('dark', 0.03, 0.16, 0.03, 0.1, 1.0, 0.262),
  );

const mopBucket: FurnitureBuilder = (kit) => {
  const handle = kit.cyl('wood', 0.02, 1.35, 0.05, 0.1, 0);
  handle.rotation.z = -0.22;
  return kit.group(kit.cyl('accent', 0.22, 0.32, 0, 0, 0), handle);
};

const reception: FurnitureBuilder = (kit) =>
  kit.group(
    kit.box('wood', 2.6, 1.02, 0.6, 0, 0, 0),
    kit.box('white', 2.8, 0.05, 0.78, 0, 1.02, 0),
    kit.box('accent', 2.6, 0.3, 0.02, 0, 0.36, 0.31),
    chair(kit, 0, -0.85, Math.PI),
  );

const BOOKS: MaterialSlot[] = ['accent', 'dark', 'white', 'metal', 'fabric'];

const bookshelf: FurnitureBuilder = (kit, item) => {
  const random = seeded(Math.round(item.x * 31 + item.z * 17) + 7);
  const parts: THREE.Object3D[] = [
    kit.box('wood', 1.8, 1.92, 0.04, 0, 0, -0.16),
    kit.box('wood', 0.04, 1.92, 0.36, -0.9, 0, 0),
    kit.box('wood', 0.04, 1.92, 0.36, 0.9, 0, 0),
  ];
  for (const y of [0.04, 0.66, 1.28, 1.88]) parts.push(kit.box('wood', 1.8, 0.04, 0.36, 0, y, 0));
  for (const y of [0.08, 0.7, 1.32]) {
    for (let x = -0.8; x < 0.72; ) {
      const w = 0.06 + random() * 0.07;
      if (random() > 0.18) {
        parts.push(kit.box(BOOKS[Math.floor(random() * BOOKS.length)]!, w, 0.3 + random() * 0.2, 0.24, x + w / 2, y, 0));
      }
      x += w + 0.012;
    }
  }
  return kit.group(...parts);
};

/** The built-in furniture. A theme may replace any entry through `theme.furniture`. */
export const defaultFurniture: Record<FurnitureKind, FurnitureBuilder> = {
  desk, benchDivider, sofa, coffeeTable, plant, meetingTable, whiteboard, screenWall,
  serverRack, treadmill, weights, gymBench, locker, mopBucket, reception, bookshelf,
};
