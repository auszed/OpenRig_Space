import type { FurnitureItem, MaterialSlot, OfficeTheme, PbrMaterial } from '@backoffice/core';
import * as THREE from 'three';

export type Materials = Record<MaterialSlot, THREE.Material>;

/** Draws one piece of furniture around its own origin (floor level, front towards +z). */
export type FurnitureBuilder = (kit: Kit, item: FurnitureItem) => THREE.Object3D;

export function makeMaterial(p: PbrMaterial): THREE.Material {
  if (p.opacity !== undefined && p.opacity < 1) {
    return new THREE.MeshPhysicalMaterial({
      color: p.color, roughness: p.roughness, metalness: p.metalness,
      transparent: true, opacity: p.opacity, depthWrite: false, side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: p.color, roughness: p.roughness, metalness: p.metalness,
    emissive: p.emissive ?? '#000000', emissiveIntensity: p.emissiveIntensity ?? 0,
  });
}

export function makeMaterials(theme: OfficeTheme<unknown>): Materials {
  const out = {} as Materials;
  for (const slot of Object.keys(theme.materials) as MaterialSlot[]) out[slot] = makeMaterial(theme.materials[slot]);
  return out;
}

export function disposeMaterials(mats: Materials): void {
  for (const mat of Object.values(mats)) mat.dispose();
}

// One copy of each basic shape, scaled per use, so rebuilding the office allocates no geometry.
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 24);
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CONE = new THREE.ConeGeometry(1, 1, 18);

/** The handful of shapes everything in the office is made of. `y` is always the underside. */
export class Kit {
  constructor(readonly mats: Materials) {}

  private mesh(geometry: THREE.BufferGeometry, slot: MaterialSlot, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(geometry, this.mats[slot]);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    const solid = slot !== 'glass';
    mesh.castShadow = solid;
    mesh.receiveShadow = solid;
    return mesh;
  }

  box(slot: MaterialSlot, w: number, h: number, d: number, x = 0, y = 0, z = 0) {
    return this.mesh(BOX, slot, w, h, d, x, y + h / 2, z);
  }

  cyl(slot: MaterialSlot, r: number, h: number, x = 0, y = 0, z = 0) {
    return this.mesh(CYLINDER, slot, r, h, r, x, y + h / 2, z);
  }

  cone(slot: MaterialSlot, r: number, h: number, x = 0, y = 0, z = 0) {
    return this.mesh(CONE, slot, r, h, r, x, y + h / 2, z);
  }

  /** A ball resting on `y`. */
  ball(slot: MaterialSlot, r: number, x = 0, y = 0, z = 0) {
    return this.mesh(SPHERE, slot, r, r, r, x, y + r, z);
  }

  group(...children: THREE.Object3D[]) {
    const g = new THREE.Group();
    if (children.length) g.add(...children);
    return g;
  }
}

/** Small repeatable random number generator, so trees and books land in the same place every load. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
