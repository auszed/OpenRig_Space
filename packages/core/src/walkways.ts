import type { FurnitureItem, FurnitureKind, Layout } from './layout.ts';

/**
 * How people move through the office: on a grid over the floor where furniture and walls are
 * blocked (door openings are not), in straight lines along the two floor axes only. Walkway
 * cells are cheaper than open floor and every turn costs extra, so a route follows the walkways
 * with as few corners as it can, and leaves a seat by the shortest straight step to open floor.
 */

export interface Point {
  x: number;
  z: number;
}

/** One straight piece of walkway, along x or along z. */
export interface Walkway {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export const CELL = 0.25;
/** Room kept around furniture and walls for a body to pass. */
const CLEARANCE = 0.2;
const WALL_THICKNESS = 0.16;
/** Doorways are this wide in the building; a little less is kept open for walking. */
const DOOR_OPEN = 1.3;
const WALKWAY_HALF = 0.35;
const STEP_FREE = 1;
const STEP_WALKWAY = 1;
const STEP_FLOOR = 3;
const TURN = 4;
/** How far a seat may sit inside furniture before the way out counts as blocked. */
const EXIT_REACH = 2.5;

/** Floor area each kind of furniture blocks, before turning: [width along x, depth along z, z offset]. */
const FOOTPRINT: Record<FurnitureKind, (item: FurnitureItem) => [number, number, number]> = {
  // A desk's own chair is where its person sits, so only the desk itself blocks.
  desk: () => [1.7, 0.8, 0],
  benchDivider: (item) => [item.w ?? 3, 0.06, 0],
  sofa: () => [2.2, 0.9, 0],
  coffeeTable: () => [1.3, 0.75, 0],
  plant: () => [0.6, 0.6, 0],
  // The table and the chairs drawn around it.
  meetingTable: () => [4.0, 2.6, 0],
  whiteboard: () => [3.1, 0.1, 0],
  screenWall: (item) => [item.w ?? 3, 0.1, 0],
  serverRack: () => [0.9, 0.9, 0],
  treadmill: () => [0.75, 1.75, 0],
  weights: () => [1.5, 0.42, 0],
  gymBench: () => [1.5, 0.42, 0],
  locker: () => [0.95, 0.5, 0],
  mopBucket: () => [0.5, 0.5, 0],
  // The counter and the chair behind it.
  reception: () => [2.8, 1.6, -0.4],
  bookshelf: () => [1.8, 0.4, 0],
  chair: () => [0.5, 0.5, 0],
};

export class FloorGrid {
  readonly cols: number;
  readonly rows: number;
  readonly x0: number;
  readonly z0: number;
  readonly blocked: Uint8Array;
  readonly walkway: Uint8Array;

  constructor(readonly layout: Layout) {
    this.x0 = -layout.width / 2;
    this.z0 = -layout.depth / 2;
    this.cols = Math.ceil(layout.width / CELL);
    this.rows = Math.ceil(layout.depth / CELL);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.walkway = new Uint8Array(this.cols * this.rows);

    for (const item of layout.furniture) this.blockItem(item);
    for (const zone of layout.zones) {
      // Desks and the divider of every bench.
      const perRow = Math.ceil(zone.seats / 2);
      const rows = zone.seats > 1 ? 2 : 1;
      const w = perRow * 1.7;
      const d = rows === 2 ? 0.8 * 2 + 0.1 : 0.8;
      const zc = rows === 2 ? zone.z : zone.z - 0.45;
      this.blockRect(zone.x - w / 2, zone.x + w / 2, zc - d / 2, zc + d / 2);
    }
    for (const wall of layout.walls) this.blockWall(wall.x1, wall.z1, wall.x2, wall.z2, wall.door);
    for (const w of layout.walkways) this.markWalkway(w);
  }

  index(c: number, r: number): number {
    return r * this.cols + c;
  }
  cellOf(p: Point): [number, number] {
    return [Math.floor((p.x - this.x0) / CELL), Math.floor((p.z - this.z0) / CELL)];
  }
  centre(c: number, r: number): Point {
    return { x: this.x0 + (c + 0.5) * CELL, z: this.z0 + (r + 0.5) * CELL };
  }
  inside(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }
  isFree(c: number, r: number): boolean {
    return this.inside(c, r) && !this.blocked[this.index(c, r)];
  }

  private fill(minX: number, maxX: number, minZ: number, maxZ: number, into: Uint8Array) {
    const [c1, r1] = this.cellOf({ x: minX, z: minZ });
    const [c2, r2] = this.cellOf({ x: maxX, z: maxZ });
    for (let r = Math.max(0, r1); r <= Math.min(this.rows - 1, r2); r++) {
      for (let c = Math.max(0, c1); c <= Math.min(this.cols - 1, c2); c++) into[this.index(c, r)] = 1;
    }
  }

  blockRect(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.fill(minX - CLEARANCE, maxX + CLEARANCE, minZ - CLEARANCE, maxZ + CLEARANCE, this.blocked);
  }

  private blockItem(item: FurnitureItem) {
    const [w, d, dz] = FOOTPRINT[item.kind](item);
    const rot = item.rot ?? 0;
    const [cos, sin] = [Math.cos(rot), Math.sin(rot)];
    // The box around the turned footprint (exact for quarter turns).
    const corners = [[-w / 2, dz - d / 2], [w / 2, dz - d / 2], [-w / 2, dz + d / 2], [w / 2, dz + d / 2]].map(([lx, lz]) => ({
      x: item.x + lx! * cos + lz! * sin,
      z: item.z - lx! * sin + lz! * cos,
    }));
    const xs = corners.map((p) => p.x);
    const zs = corners.map((p) => p.z);
    // Shave a hair off so a quarter-turned box does not spill into the next cell by rounding.
    this.blockRect(Math.min(...xs) + 1e-6, Math.max(...xs) - 1e-6, Math.min(...zs) + 1e-6, Math.max(...zs) - 1e-6);
  }

  private blockWall(x1: number, z1: number, x2: number, z2: number, door?: number) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const piece = (from: number, to: number) => {
      if (to - from <= 0) return;
      const [ax, az] = [x1 + ((x2 - x1) * from) / length, z1 + ((z2 - z1) * from) / length];
      const [bx, bz] = [x1 + ((x2 - x1) * to) / length, z1 + ((z2 - z1) * to) / length];
      const t = WALL_THICKNESS / 2;
      this.blockRect(Math.min(ax, bx) - t, Math.max(ax, bx) + t, Math.min(az, bz) - t, Math.max(az, bz) + t);
    };
    if (door === undefined) return piece(0, length);
    // The opening loses the clearance on both sides, so leave it wider by that much.
    const centre = length * door;
    const half = DOOR_OPEN / 2 + CLEARANCE;
    piece(0, centre - half);
    piece(centre + half, length);
  }

  private markWalkway(w: Walkway) {
    this.fill(
      Math.min(w.x1, w.x2) - WALKWAY_HALF + 1e-6, Math.max(w.x1, w.x2) + WALKWAY_HALF - 1e-6,
      Math.min(w.z1, w.z2) - WALKWAY_HALF + 1e-6, Math.max(w.z1, w.z2) + WALKWAY_HALF - 1e-6,
      this.walkway,
    );
  }

  /**
   * The nearest open cell straight along one axis from `p`, and the point there that keeps the
   * step perfectly straight. A point already on open floor is its own way out.
   */
  exit(p: Point): { cell: [number, number]; point: Point } | null {
    const [c, r] = this.cellOf(p);
    if (this.isFree(c, r)) return { cell: [c, r], point: p };
    let best: { cell: [number, number]; point: Point; dist: number } | null = null;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let k = 1; k * CELL <= EXIT_REACH; k++) {
        const [cc, rr] = [c + dc * k, r + dr * k];
        if (!this.inside(cc, rr)) break;
        if (this.isFree(cc, rr)) {
          const centre = this.centre(cc, rr);
          const point = dc !== 0 ? { x: centre.x, z: p.z } : { x: p.x, z: centre.z };
          const dist = Math.abs(point.x - p.x) + Math.abs(point.z - p.z);
          if (!best || dist < best.dist) best = { cell: [cc, rr], point, dist };
          break;
        }
      }
    }
    return best;
  }

  /** The cheapest four-way path between two open cells, as its cells; null when there is none. */
  search(from: [number, number], to: [number, number]): Array<[number, number]> | null {
    const n = this.cols * this.rows;
    const DIRS: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    // State = cell * 4 + heading.
    const cost = new Float64Array(n * 4).fill(Infinity);
    const came = new Int32Array(n * 4).fill(-1);
    const heap = new MinHeap();
    const goal = this.index(to[0], to[1]);
    const h = (c: number, r: number) => (Math.abs(c - to[0]) + Math.abs(r - to[1])) * STEP_WALKWAY;
    const start = this.index(from[0], from[1]);
    for (let d = 0; d < 4; d++) {
      cost[start * 4 + d] = 0;
      heap.push(start * 4 + d, h(from[0], from[1]));
    }
    while (heap.size > 0) {
      const state = heap.pop();
      const cell = state >> 2;
      const heading = state & 3;
      if (cell === goal) {
        const cells: Array<[number, number]> = [];
        for (let s = state; s !== -1; s = came[s]!) cells.push([(s >> 2) % this.cols, Math.floor((s >> 2) / this.cols)]);
        return cells.reverse();
      }
      const c = cell % this.cols;
      const r = Math.floor(cell / this.cols);
      const here = cost[state]!;
      for (let d = 0; d < 4; d++) {
        if (d === ((heading + 2) & 3)) continue;
        const [dc, dr] = DIRS[d]!;
        const [nc, nr] = [c + dc, r + dr];
        if (!this.inside(nc, nr)) continue;
        const ni = this.index(nc, nr);
        if (this.blocked[ni] && ni !== goal) continue;
        const step = (this.walkway[ni] ? STEP_WALKWAY : STEP_FLOOR) * STEP_FREE + (d === heading ? 0 : TURN);
        const next = ni * 4 + d;
        if (here + step < cost[next]!) {
          cost[next] = here + step;
          came[next] = state;
          heap.push(next, here + step + h(nc, nr));
        }
      }
    }
    return null;
  }
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    const { items, keys } = this;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      items[i] = items[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }
  pop(): number {
    const { items, keys } = this;
    const top = items[0]!;
    const lastItem = items.pop()!;
    const lastKey = keys.pop()!;
    if (items.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= items.length) break;
        const r = l + 1;
        const m = r < items.length && keys[r]! < keys[l]! ? r : l;
        if (keys[m]! >= lastKey) break;
        items[i] = items[m]!;
        keys[i] = keys[m]!;
        i = m;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}

const grids = new WeakMap<Layout, FloorGrid>();

/** The floor grid of a layout, built once per layout. */
export function floorGrid(layout: Layout): FloorGrid {
  let grid = grids.get(layout);
  if (!grid) grids.set(layout, (grid = new FloorGrid(layout)));
  return grid;
}

/** Inserts a corner wherever two points differ on both axes, so every leg runs along one axis. */
export function straighten(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) > 1e-6 && Math.abs(prev.z - p.z) > 1e-6) out.push({ x: prev.x, z: p.z });
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.z - p.z) > 1e-6) out.push(p);
  }
  // Drop middle points of straight runs.
  return out.filter((p, i) => {
    const a = out[i - 1];
    const b = out[i + 1];
    if (!a || !b) return true;
    const sameX = Math.abs(a.x - p.x) < 1e-6 && Math.abs(b.x - p.x) < 1e-6;
    const sameZ = Math.abs(a.z - p.z) < 1e-6 && Math.abs(b.z - p.z) < 1e-6;
    return !(sameX || sameZ);
  });
}

/**
 * The way from one point to another over open floor: straight out of the seat, along the
 * walkways, straight into the other seat. Returns the corners to walk through, ending at `to`,
 * or null if the floor offers no way (the caller then picks its own).
 */
export function walk(from: Point, to: Point, layout: Layout): Point[] | null {
  const grid = floorGrid(layout);
  const a = grid.exit(from);
  const b = grid.exit(to);
  if (!a || !b) return null;
  const cells = grid.search(a.cell, b.cell);
  if (!cells) return null;
  // Corners of the cell path: where the heading changes.
  const corners: Point[] = [];
  for (let i = 1; i < cells.length - 1; i++) {
    const [p, c, n] = [cells[i - 1]!, cells[i]!, cells[i + 1]!];
    if (p[0] - c[0] !== c[0] - n[0] || p[1] - c[1] !== c[1] - n[1]) corners.push(grid.centre(c[0], c[1]));
  }
  // Snap the first and last corners onto the straight steps out of and into the seats.
  const path = straighten([from, a.point, ...corners, b.point, to]);
  return path.slice(1);
}
