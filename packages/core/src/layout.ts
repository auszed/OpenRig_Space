import { behaviorFor, whereabouts } from './behavior.ts';
import type { Agent, QueueItem } from './model.ts';

/**
 * The floor plan as data. Units are metres; x runs left to right, z runs from
 * the back wall (negative) to the open front (positive). A layout says where
 * things are, never what they look like.
 */

export type WallKind = 'solid' | 'glass';
export type FloorKind = 'floor' | 'carpet' | 'woodFloor' | 'rubber';
export type RoomPurpose = 'standup' | 'review' | 'qa' | 'gym' | 'janitor' | 'team' | 'lounge';

export interface Room {
  id: string;
  name: string;
  purpose: RoomPurpose;
  /** Corner nearest the back-left, then size. */
  x: number;
  z: number;
  w: number;
  d: number;
  floor: FloorKind;
  /** Middle of the doorway, for rooms agents walk in and out of. */
  door?: { x: number; z: number };
}

export interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  kind: WallKind;
  height: number;
  /** Centre of a door opening, as a fraction of the wall's length. */
  door?: number;
}

/** A carpeted patch of open plan holding one bench of desks. */
export interface Zone {
  id: string;
  /** Centre of the bench. */
  x: number;
  z: number;
  seats: number;
  /** Reserve this zone for one rig (used for the glass room). */
  preferRig?: string;
}

export type FurnitureKind =
  | 'desk' | 'benchDivider' | 'sofa' | 'coffeeTable' | 'plant' | 'meetingTable' | 'whiteboard'
  | 'screenWall' | 'serverRack' | 'treadmill' | 'weights' | 'gymBench' | 'locker' | 'mopBucket'
  | 'reception' | 'bookshelf' | 'chair';

export interface FurnitureItem {
  kind: FurnitureKind;
  x: number;
  z: number;
  /** Rotation around the vertical axis, in radians. */
  rot?: number;
  /** Width override for pieces that stretch (dividers, screens). */
  w?: number;
}

export interface Layout {
  width: number;
  depth: number;
  rooms: Room[];
  walls: Wall[];
  zones: Zone[];
  furniture: FurnitureItem[];
  /** Where agents stand when every desk is taken. */
  overflow: { x: number; z: number };
  /** Where idle agents wait. */
  lounge: WaitingArea;
  /** Where agents waiting on a pull request sit and talk. */
  review: WaitingArea;
}

export type Posture = 'desk' | 'sofa' | 'chair' | 'stand';

/** One place to sit away from a desk. */
export interface Spot {
  x: number;
  z: number;
  rot: number;
  posture: Posture;
}

export interface WaitingArea {
  spots: Spot[];
  /** Where the people without a seat stand: first place, how many side by side, which way they face. */
  standing: { x: number; z: number; perRow: number; rot: number };
}

export interface Desk {
  id: string;
  zoneId: string;
  x: number;
  z: number;
  rot: number;
}

/** Where one agent is, and which way it faces. */
export interface Seat {
  x: number;
  z: number;
  rot: number;
  /** The desk the agent is sitting at right now, or null when it is somewhere else. */
  deskId: string | null;
  zoneId: string | null;
  posture: Posture;
}

export const DESK_WIDTH = 1.7;
export const DESK_DEPTH = 0.8;
/** Distance from the middle of a desk to the person sitting at it. */
export const SEAT_OFFSET = 0.8;

/** A bench is two rows of desks facing each other across a low divider. */
export function desksForZone(zone: Zone): Desk[] {
  const perRow = Math.ceil(zone.seats / 2);
  const desks: Desk[] = [];
  for (let i = 0; i < zone.seats; i++) {
    const row = i % 2;
    const col = Math.floor(i / 2);
    desks.push({
      id: `${zone.id}-${i + 1}`,
      zoneId: zone.id,
      x: zone.x + (col - (perRow - 1) / 2) * DESK_WIDTH,
      z: zone.z + (row === 0 ? -1 : 1) * (DESK_DEPTH / 2 + 0.05),
      // Row 0 sits on the back side and looks towards the front; row 1 the reverse.
      rot: row === 0 ? Math.PI : 0,
    });
  }
  return desks;
}

export function seatAtDesk(desk: Desk): Seat {
  return {
    x: desk.x + Math.sin(desk.rot) * SEAT_OFFSET,
    z: desk.z + Math.cos(desk.rot) * SEAT_OFFSET,
    rot: desk.rot,
    deskId: desk.id,
    zoneId: desk.zoneId,
    posture: 'desk',
  };
}

export interface Assignment {
  seats: Map<string, Seat>;
  /** Which pods ended up in each zone, for the floor labels. */
  zoneLabels: Map<string, string[]>;
}

/**
 * Gives every agent a home desk. Pods stay together, each pod gets its own bench
 * while benches last, and the result depends only on who exists (not on what
 * they are doing), so nobody changes desk when a status changes.
 */
export function assignSeats(agents: Agent[], layout: Layout): Assignment {
  const free = new Map<string, Desk[]>(layout.zones.map((z) => [z.id, desksForZone(z)]));
  const used = new Set<string>();
  const seats = new Map<string, Seat>();
  const zoneLabels = new Map<string, string[]>();

  const groups = new Map<string, Agent[]>();
  for (const a of [...agents].sort((p, q) => p.name.localeCompare(q.name) || p.id.localeCompare(q.id))) {
    const key = `${a.rig}\u0000${a.pod}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  const place = (agent: Agent, zone: Zone): boolean => {
    const desk = free.get(zone.id)?.shift();
    if (!desk) return false;
    seats.set(agent.id, seatAtDesk(desk));
    used.add(zone.id);
    const labels = zoneLabels.get(zone.id) ?? [];
    if (!labels.includes(agent.pod)) zoneLabels.set(zone.id, [...labels, agent.pod]);
    return true;
  };
  const room = (z: Zone) => free.get(z.id)?.length ?? 0;

  for (const [, members] of ordered) {
    const rig = members[0]!.rig;
    const reserved = layout.zones.filter((z) => z.preferRig === rig);
    const open = layout.zones.filter((z) => !z.preferRig);
    const candidates = [
      ...reserved,
      // An untouched bench first, then any bench the whole pod still fits on, then whatever is left.
      ...open.filter((z) => !used.has(z.id) && room(z) >= members.length),
      ...open.filter((z) => room(z) >= members.length),
      ...open,
    ];
    for (const agent of members) {
      const zone = candidates.find((z) => room(z) > 0);
      if (!zone || !place(agent, zone)) {
        const n = [...seats.values()].filter((s) => s.deskId === null).length;
        seats.set(agent.id, {
          x: layout.overflow.x + (n % 4) * 1.1,
          z: layout.overflow.z + Math.floor(n / 4) * 1.1,
          rot: 0,
          deskId: null,
          zoneId: null,
          posture: 'stand',
        });
      }
    }
  }
  return { seats, zoneLabels };
}

const STAND_PITCH = 0.9;

/**
 * Where every agent is right now. `home` is the desk each one owns
 * (`assignSeats`); an agent is only at it while `whereabouts` says so, and
 * otherwise takes a seat in the lounge or the review room. Each agent keeps
 * the same waiting seat while the same people exist, and whoever does not fit
 * stands.
 */
export function locateAgents(agents: Agent[], queue: QueueItem[], layout: Layout, home: Map<string, Seat>): Map<string, Seat> {
  const ranked = [...agents].sort(
    (a, b) => a.rig.localeCompare(b.rig) || a.pod.localeCompare(b.pod) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const seats = new Map<string, Seat>();
  const waiting: Record<'lounge' | 'review', Array<{ agent: Agent; rank: number }>> = { lounge: [], review: [] };

  ranked.forEach((agent, rank) => {
    const where = whereabouts(agent, queue);
    const desk = home.get(agent.id);
    if (where === 'desk') {
      if (desk) seats.set(agent.id, desk);
    } else {
      waiting[where].push({ agent, rank });
    }
  });

  for (const where of ['lounge', 'review'] as const) {
    const area = layout[where];
    const taken = new Set<number>();
    const late: Agent[] = [];
    for (const { agent, rank } of waiting[where]) {
      if (rank < area.spots.length) {
        taken.add(rank);
        seats.set(agent.id, { ...area.spots[rank]!, deskId: null, zoneId: null });
      } else {
        late.push(agent);
      }
    }
    let standing = 0;
    for (const agent of late) {
      const free = area.spots.findIndex((_, i) => !taken.has(i));
      if (free >= 0) {
        taken.add(free);
        seats.set(agent.id, { ...area.spots[free]!, deskId: null, zoneId: null });
        continue;
      }
      const { x, z, perRow, rot } = area.standing;
      // Rows run across the way people face, and stack up behind the first one.
      const along = (standing % perRow) * STAND_PITCH;
      const back = Math.floor(standing / perRow) * STAND_PITCH;
      seats.set(agent.id, {
        x: x + Math.cos(rot) * along + Math.sin(rot) * back,
        z: z - Math.sin(rot) * along + Math.cos(rot) * back,
        rot,
        deskId: null,
        zoneId: null,
        posture: 'stand',
      });
      standing++;
    }
  }
  return seats;
}

/** The desks whose screen is lit: the owner is at it and has something on it. */
export function litDesks(agents: Agent[], queue: QueueItem[], home: Map<string, Seat>): Set<string> {
  const lit = new Set<string>();
  for (const agent of agents) {
    const deskId = home.get(agent.id)?.deskId;
    if (deskId && whereabouts(agent, queue) === 'desk' && behaviorFor(agent).screenOn) lit.add(deskId);
  }
  return lit;
}

/**
 * The corners to walk through to get from one point to another: out of the
 * door of the room being left, in at the door of the room being entered.
 */
export function route(from: { x: number; z: number }, to: { x: number; z: number }, layout: Layout): Array<{ x: number; z: number }> {
  const roomAt = (p: { x: number; z: number }) =>
    layout.rooms.find((r) => r.door && p.x > r.x && p.x < r.x + r.w && p.z > r.z && p.z < r.z + r.d);
  const [a, b] = [roomAt(from), roomAt(to)];
  if (a === b) return [to];
  const through = (room: Room): [inside: { x: number; z: number }, outside: { x: number; z: number }] => {
    const door = room.door!;
    const onZ = Math.abs(door.z - room.z) < 0.01 || Math.abs(door.z - (room.z + room.d)) < 0.01;
    const sign = onZ ? Math.sign(room.z + room.d / 2 - door.z) : Math.sign(room.x + room.w / 2 - door.x);
    const at = (d: number) => (onZ ? { x: door.x, z: door.z + sign * d } : { x: door.x + sign * d, z: door.z });
    return [at(0.7), at(-0.7)];
  };
  const path: Array<{ x: number; z: number }> = [];
  if (a) path.push(...through(a));
  if (b) path.push(...through(b).reverse());
  return [...path, to];
}

const SOFA_SEATS = [-0.62, 0, 0.62];

/** The three places on a sofa. A sofa looks along its own +z; whoever sits on it looks the same way. */
function sofaSpots(x: number, z: number, rot = 0): Spot[] {
  return SOFA_SEATS.map((lx) => ({
    x: x + lx * Math.cos(rot) + 0.05 * Math.sin(rot),
    z: z - lx * Math.sin(rot) + 0.05 * Math.cos(rot),
    rot: rot + Math.PI,
    posture: 'sofa' as const,
  }));
}

const LOUNGE_X = -13.6;
/** The middle of each group of sofas, back to front. */
const LOUNGE_GROUPS = [-2.9, 2.5];

/** The default floor plan: back rooms behind glass, benches in the open plan, a lounge down the left side. */
export function defaultLayout(): Layout {
  const H = 2.5;
  const wall = (x1: number, z1: number, x2: number, z2: number, kind: WallKind, door?: number, height = H): Wall =>
    ({ x1, z1, x2, z2, kind, height, ...(door === undefined ? {} : { door }) });

  type Placed = [x: number, z: number, rot: number];
  // A chair's back is on its own +z side, so whoever sits on it faces the way the chair is turned.
  const chairSpot = ([x, z, rot]: Placed): Spot => ({ x, z, rot, posture: 'chair' });

  // Lounge: two groups, each three sofas and four chairs around a coffee table. 26 seats for 24 desks.
  const loungeSofas: Placed[] = LOUNGE_GROUPS.flatMap((z): Placed[] => [
    [LOUNGE_X, z - 1.9, 0],
    [LOUNGE_X, z + 1.9, Math.PI],
    [LOUNGE_X - 2.6, z, Math.PI / 2],
  ]);
  const loungeChairs: Placed[] = LOUNGE_GROUPS.flatMap((z) =>
    [-1.35, -0.45, 0.45, 1.35].map((dz): Placed => [LOUNGE_X + 2.5, z + dz, Math.PI / 2]),
  );

  // PR review: chairs down both sides of the table and beside the sofa, all turned to the middle.
  const reviewSofa: Placed = [-5, -8.6, Math.PI];
  const reviewChairs: Placed[] = [
    ...[-11, -10.1, -9.2].flatMap((z): Placed[] => [[-7.2, z, -Math.PI / 2], [-2.8, z, Math.PI / 2]]),
    [-6.7, -8.4, -0.35],
    [-3.3, -8.4, 0.35],
  ];

  return {
    width: 36,
    depth: 28,
    overflow: { x: -1.6, z: 12.6 },
    lounge: {
      spots: [...loungeSofas.flatMap(([x, z, rot]) => sofaSpots(x, z, rot)), ...loungeChairs.map(chairSpot)],
      standing: { x: -9.9, z: 5.3, perRow: 12, rot: Math.PI / 2 },
    },
    review: {
      spots: [...reviewChairs.map(chairSpot), ...sofaSpots(...reviewSofa)],
      standing: { x: -2.0, z: -12.3, perRow: 8, rot: Math.PI },
    },
    rooms: [
      { id: 'standup', name: 'Standup room', purpose: 'standup', x: -18, z: -14, w: 9, d: 7, floor: 'woodFloor' },
      { id: 'review', name: 'PR review', purpose: 'review', x: -9, z: -14, w: 8, d: 7, floor: 'carpet', door: { x: -5, z: -7 } },
      { id: 'kernel', name: 'Kernel', purpose: 'team', x: -1, z: -14, w: 9, d: 7, floor: 'carpet', door: { x: 3.5, z: -7 } },
      { id: 'qa', name: 'QA lab', purpose: 'qa', x: 8, z: -14, w: 10, d: 7, floor: 'floor' },
      { id: 'gym', name: 'Gym', purpose: 'gym', x: 11, z: -7, w: 7, d: 9, floor: 'rubber' },
      { id: 'janitor', name: 'Janitor', purpose: 'janitor', x: 13, z: 2, w: 5, d: 5, floor: 'floor' },
      { id: 'lounge', name: 'Lounge', purpose: 'lounge', x: -17.5, z: -5.6, w: 9, d: 11.5, floor: 'carpet' },
    ],
    walls: [
      // Outer shell: tall and solid at the back and left, glass on the right, open at the front.
      wall(-18, -14, 18, -14, 'solid', undefined, 3),
      wall(-18, -14, -18, 14, 'solid', undefined, 3),
      wall(18, -14, 18, 7, 'glass'),
      // Fronts of the back rooms.
      wall(-18, -7, -9, -7, 'glass', 0.5),
      wall(-9, -7, -1, -7, 'glass', 0.5),
      wall(-1, -7, 8, -7, 'glass', 0.5),
      wall(8, -7, 11, -7, 'glass', 0.5),
      wall(11, -7, 18, -7, 'solid'),
      // Dividers between the back rooms.
      wall(-9, -14, -9, -7, 'solid'),
      wall(-1, -14, -1, -7, 'glass'),
      wall(8, -14, 8, -7, 'solid'),
      // Gym and janitor closet.
      wall(11, -7, 11, 2, 'glass', 0.5),
      wall(11, 2, 13, 2, 'solid'),
      wall(13, 2, 18, 2, 'solid'),
      wall(13, 2, 13, 7, 'solid', 0.5),
      wall(13, 7, 18, 7, 'solid'),
    ],
    zones: [
      { id: 'kernel', x: 3.5, z: -10.5, seats: 4, preferRig: 'kernel' },
      { id: 'a', x: -5, z: -1.5, seats: 4 },
      { id: 'b', x: 4.5, z: -1.5, seats: 4 },
      { id: 'c', x: -5, z: 8, seats: 4 },
      { id: 'd', x: 4.5, z: 8, seats: 4 },
      { id: 'e', x: -13.5, z: 9.5, seats: 4 },
    ],
    furniture: [
      // Standup room
      { kind: 'meetingTable', x: -13.5, z: -10.3 },
      { kind: 'whiteboard', x: -13.5, z: -13.85 },
      { kind: 'plant', x: -17.2, z: -7.8 },
      // PR review
      { kind: 'screenWall', x: -5, z: -13.85, w: 4.5 },
      { kind: 'coffeeTable', x: -5, z: -10.5 },
      { kind: 'sofa', x: reviewSofa[0], z: reviewSofa[1], rot: reviewSofa[2] },
      ...reviewChairs.map(([x, z, rot]) => ({ kind: 'chair' as const, x, z, rot })),
      // Kernel
      { kind: 'plant', x: 7.2, z: -13.2 },
      { kind: 'bookshelf', x: -0.2, z: -13.6, rot: 0 },
      // QA lab
      { kind: 'serverRack', x: 10, z: -13.4 },
      { kind: 'serverRack', x: 11.2, z: -13.4 },
      { kind: 'serverRack', x: 12.4, z: -13.4 },
      { kind: 'screenWall', x: 15.3, z: -13.85, w: 3.6 },
      { kind: 'desk', x: 15.3, z: -10.2, rot: Math.PI },
      // Gym
      { kind: 'treadmill', x: 13, z: -4.8 },
      { kind: 'treadmill', x: 14.6, z: -4.8 },
      { kind: 'weights', x: 16.8, z: -2 },
      { kind: 'gymBench', x: 13.6, z: -0.2, rot: Math.PI / 2 },
      // Janitor
      { kind: 'locker', x: 17.4, z: 3, rot: -Math.PI / 2 },
      { kind: 'locker', x: 17.4, z: 4.1, rot: -Math.PI / 2 },
      { kind: 'mopBucket', x: 14.6, z: 5.8 },
      // Lounge
      ...loungeSofas.map(([x, z, rot]) => ({ kind: 'sofa' as const, x, z, rot })),
      ...loungeChairs.map(([x, z, rot]) => ({ kind: 'chair' as const, x, z, rot })),
      ...LOUNGE_GROUPS.map((z) => ({ kind: 'coffeeTable' as const, x: LOUNGE_X, z })),
      { kind: 'plant', x: -17.1, z: -5.8 },
      { kind: 'bookshelf', x: -17.6, z: 3.4, rot: Math.PI / 2 },
      // Open plan
      { kind: 'reception', x: -0.3, z: 3.3 },
      { kind: 'plant', x: -9.6, z: -5.8 },
      { kind: 'plant', x: 9.6, z: 3.2 },
      { kind: 'plant', x: -9.4, z: 12.4 },
      { kind: 'plant', x: 9.4, z: 12.4 },
      { kind: 'plant', x: -0.3, z: -5.6 },
      { kind: 'plant', x: -17, z: 13 },
    ],
  };
}
