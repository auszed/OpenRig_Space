import type { Layout } from '@backoffice/core';
import type * as THREE from 'three';
import { seeded, type Kit } from './kit.ts';

/** Height of the plinth the office stands on; the lawn is this far below the office floor. */
export const PLINTH = 0.34;

/** The campus around the office: plinth, lawn, paths, trees and a few neighbouring buildings. */
export function buildExterior(kit: Kit, layout: Layout): THREE.Group {
  const random = seeded(20261114);
  const g = kit.group();
  const halfW = layout.width / 2;
  const halfD = layout.depth / 2;
  const ground = -PLINTH;

  g.add(kit.box('plinth', layout.width + 1.6, PLINTH - 0.04, layout.depth + 1.6, 0, ground, 0));
  const lawn = kit.cyl('grass', 95, 0.3, 0, ground - 0.3, 0);
  lawn.castShadow = false;
  g.add(lawn);

  // A path from the open front out to a cross path, and steps down from the plinth.
  g.add(kit.box('path', 5, 0.03, 34, 0, ground, halfD + 0.8 + 17));
  g.add(kit.box('path', 120, 0.03, 4, 0, ground, halfD + 20));
  g.add(kit.box('plinth', 6, PLINTH / 2, 1.2, 0, ground, halfD + 1.2));

  const clear = (x: number, z: number) =>
    (Math.abs(x) < halfW + 3 && Math.abs(z) < halfD + 3) ||          // the office itself
    (Math.abs(x) < 4.5 && z > 0) ||                                  // the entrance path
    Math.abs(z - (halfD + 20)) < 3.5;                                // the cross path

  const buildings: Array<[x: number, z: number, w: number, h: number, d: number]> = [
    [-46, -34, 20, 9, 13],
    [40, -40, 15, 15, 15],
    [52, 6, 12, 7, 22],
    [-52, 14, 12, 11, 16],
  ];
  for (const [x, z, w, h, d] of buildings) {
    g.add(kit.box('building', w, h, d, x, ground, z));
    for (let y = 1.4; y < h - 0.8; y += 2.6) g.add(kit.box('dark', w + 0.06, 0.9, d + 0.06, x, ground + y, z));
    g.add(kit.box('plinth', w + 0.4, 0.25, d + 0.4, x, ground + h, z));
  }
  const nearBuilding = (x: number, z: number) =>
    buildings.some(([bx, bz, w, , d]) => Math.abs(x - bx) < w / 2 + 2.5 && Math.abs(z - bz) < d / 2 + 2.5);

  let planted = 0;
  for (let tries = 0; planted < 46 && tries < 600; tries++) {
    const angle = random() * Math.PI * 2;
    const radius = 22 + random() * 62;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // Keep the side the camera looks in from open, so no tree stands between the viewer and the desks.
    if (clear(x, z) || nearBuilding(x, z) || (x + z > 18 && radius < 58)) continue;
    const size = 0.8 + random() * 0.7;
    const tree = kit.group(
      kit.cyl('trunk', 0.2 * size, 1.9 * size, 0, 0, 0),
      kit.ball('foliage', 1.5 * size, 0, 1.3 * size, 0),
      kit.ball('foliage', 1.05 * size, 0.5 * size, 2.9 * size, 0.2 * size),
      kit.ball('foliage', 0.95 * size, -0.5 * size, 3.0 * size, -0.3 * size),
    );
    tree.position.set(x, ground, z);
    g.add(tree);
    planted++;
  }

  // Low hedges along the two solid outer walls.
  for (let x = -halfW; x <= halfW; x += 2.2) g.add(kit.ball('foliage', 0.75, x, ground - 0.2, -halfD - 1.9));
  for (let z = -halfD; z <= halfD; z += 2.2) g.add(kit.ball('foliage', 0.75, -halfW - 1.9, ground - 0.2, z));
  return g;
}
