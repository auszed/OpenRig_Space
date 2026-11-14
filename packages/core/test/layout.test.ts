import { describe, expect, test } from 'bun:test';
import {
  assignSeats, behaviorFor, buildLayout, byAttention, defaultLayout, desksForZone, groupByTeam, isLead, litDesks, locateAgents,
  MockSource, route, waitingOnPr, whereabouts,
} from '../src/index.ts';
import type { Agent, QueueItem } from '../src/index.ts';

const agent = (id: string, rig: string, pod: string, status: Agent['status'] = 'idle'): Agent => ({
  id, name: `${pod}.${id}`, session: `${id}@${rig}`, rig, pod, kind: 'agent', runtime: 't', model: null,
  status, statusReason: null, lastActivityAt: null,
  work: { assigned: 0, pending: 0, inProgress: 0, blocked: 0 }, contextUsedPct: null,
});

describe('layout', () => {
  const growth = [
    agent('1', 'growth', 'orch'), agent('2', 'growth', 'build'), agent('3', 'growth', 'build'),
    agent('4', 'growth', 'market'), agent('5', 'growth', 'market'),
    agent('6', 'growth', 'reach'), agent('7', 'growth', 'reach'), agent('8', 'growth', 'reach'),
    agent('9', 'kernel', 'operator'), agent('10', 'kernel', 'queue'),
  ];
  const crowd = (n: number, pods = 3) => Array.from({ length: n }, (_, i) => agent(String(i), 'big', `p${i % pods}`));
  const inside = (layout: ReturnType<typeof buildLayout>, p: { x: number; z: number }) =>
    Math.abs(p.x) < layout.width / 2 && Math.abs(p.z) < layout.depth / 2;

  test('every pod gets one bench exactly its size, and the kernel rig gets the glass room', () => {
    const layout = buildLayout(growth);
    const benches = layout.zones.filter((z) => z.pod);
    expect(benches.map((z) => z.seats).sort()).toEqual([1, 2, 2, 3]);
    expect(layout.zones.find((z) => z.id === 'kernel')!.seats).toBe(2);
    const { seats, zoneLabels } = assignSeats(growth, layout);
    expect(seats.size).toBe(growth.length);
    expect([...seats.values()].every((s) => s.deskId !== null)).toBe(true);
    expect(new Set([...seats.values()].map((s) => s.deskId)).size).toBe(growth.length);
    expect(seats.get('9')!.zoneId).toBe('kernel');
    const zoneOf = (pod: string) => new Set(growth.filter((a) => a.pod === pod).map((a) => seats.get(a.id)!.zoneId));
    for (const pod of ['orch', 'build', 'market', 'reach']) expect(zoneOf(pod).size).toBe(1);
    expect(new Set(['orch', 'build', 'market', 'reach'].map((p) => [...zoneOf(p)][0])).size).toBe(4);
    expect(zoneLabels.get('kernel')).toEqual(['operator', 'queue']);
  });

  test('benches stay inside the open plan and never overlap', () => {
    for (const agents of [growth, crowd(30), crowd(80, 9), crowd(50, 1)]) {
      const layout = buildLayout(agents);
      for (const zone of layout.zones) {
        const desks = desksForZone(zone);
        expect(desks).toHaveLength(zone.seats);
        for (const d of desks) expect(inside(layout, d)).toBe(true);
      }
      const open = layout.zones.filter((z) => z.id !== 'kernel');
      for (const a of open) {
        expect(a.x - (Math.ceil(a.seats / 2) * 1.7 + 2.6) / 2).toBeGreaterThanOrEqual(-8.4 - 1e-9);
        expect(a.x + (Math.ceil(a.seats / 2) * 1.7 + 2.6) / 2).toBeLessThanOrEqual(10.6 + 1e-9);
        for (const b of open) {
          if (a === b) continue;
          const apart = Math.abs(a.x - b.x) >= (Math.ceil(a.seats / 2) + Math.ceil(b.seats / 2)) * 1.7 / 2 + 2.6 - 1e-9;
          expect(apart || Math.abs(a.z - b.z) >= 5.4).toBe(true);
        }
      }
      const { seats } = assignSeats(agents, layout);
      expect([...seats.values()].filter((s) => s.deskId === null)).toHaveLength(0);
    }
  });

  test('a big pod is split over benches, and the office grows to the front for a big rig', () => {
    const small = buildLayout(growth);
    const big = buildLayout(crowd(80, 2));
    expect(big.zones.every((z) => z.seats <= 18)).toBe(true);
    expect(big.zones.length).toBeGreaterThan(2);
    expect(big.depth).toBeGreaterThan(small.depth);
    expect(big.width).toBe(small.width);
    // The back rooms keep their place against the back wall.
    expect(big.rooms.find((r) => r.id === 'qa')!.z).toBe(-big.depth / 2);
  });

  test('extra kernel seats get a bench of their own outside the glass room', () => {
    const kernel = Array.from({ length: 11 }, (_, i) => agent(`k${i}`, 'kernel', `p${i % 2}`));
    const layout = buildLayout(kernel);
    const { seats } = assignSeats(kernel, layout);
    expect([...seats.values()].filter((s) => s.zoneId === 'kernel')).toHaveLength(8);
    expect([...seats.values()].filter((s) => s.zoneId === 'kernel-2')).toHaveLength(3);
  });

  test('the same pods give the same plan, whatever anyone is doing', () => {
    const busy = growth.map((a) => ({ ...a, status: 'working' as const })).reverse();
    expect(buildLayout(busy)).toEqual(buildLayout(growth));
    expect(defaultLayout().zones).toHaveLength(0);
  });

  test('a status change does not move anyone', () => {
    const before = [agent('1', 'r', 'a'), agent('2', 'r', 'b'), agent('3', 'r', 'b')];
    const after = before.map((a) => ({ ...a, status: 'working' as const })).reverse();
    const layout = buildLayout(before);
    expect([...assignSeats(after, layout).seats.entries()].sort())
      .toEqual([...assignSeats(before, layout).seats.entries()].sort());
  });

  test('agents beyond the last desk of a hand-made plan stand in the overflow area instead of vanishing', () => {
    const agents = crowd(30);
    const layout = { ...buildLayout([]), zones: [{ id: 'a', x: 0, z: 0, seats: 4 }] };
    const { seats } = assignSeats(agents, layout);
    expect(seats.size).toBe(30);
    const standing = [...seats.values()].filter((s) => s.deskId === null);
    expect(standing.length).toBe(26);
    expect(new Set(standing.map((s) => `${s.x},${s.z}`)).size).toBe(standing.length);
  });
});

describe('where agents are', () => {
  let layout = defaultLayout();
  const item = (over: Partial<QueueItem>): QueueItem => ({
    id: 'q', summary: 'Build the thing', state: 'pending', from: 'x@r', to: 'y@r', priority: null, blockedOn: null,
    updatedAt: '', ...over,
  });
  const inRoom = (id: string, p: { x: number; z: number }) => {
    const r = layout.rooms.find((room) => room.id === id)!;
    return p.x > r.x && p.x < r.x + r.w && p.z > r.z && p.z < r.z + r.d;
  };
  const key = (p: { x: number; z: number }) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;

  test('busy and asking agents are at their desk, idle ones in the lounge, PR waiters in review', () => {
    const agents = [
      agent('1', 'r', 'a', 'working'), agent('2', 'r', 'a', 'needs-input'), agent('3', 'r', 'a', 'idle'),
      agent('4', 'r', 'b', 'idle'), agent('5', 'r', 'b', 'unknown'),
    ];
    const queue = [item({ summary: 'PR #12 ready', from: '4@r', blockedOn: 'review' })];
    layout = buildLayout(agents);
    const home = assignSeats(agents, layout).seats;
    const now = locateAgents(agents, queue, layout, home);
    expect(now.get('1')).toEqual(home.get('1')!);
    expect(now.get('2')).toEqual(home.get('2')!);
    expect(now.get('3')!.deskId).toBeNull();
    expect(now.get('3')!.posture).toBe('sofa');
    expect(inRoom('lounge', now.get('3')!)).toBe(true);
    expect(inRoom('lounge', now.get('5')!)).toBe(true);
    expect(inRoom('review', now.get('4')!)).toBe(true);
    expect(now.get('4')!.posture).not.toBe('stand');
    expect(litDesks(agents, queue, home)).toEqual(new Set([home.get('1')!.deskId!, home.get('2')!.deskId!]));
  });

  test('waiting on a PR reads open queue items only', () => {
    const a = { session: '4@r' };
    expect(waitingOnPr(a, [item({ to: '4@r', summary: 'Open a pull request for the fix' })])).toBe(true);
    expect(waitingOnPr(a, [item({ from: '4@r', blockedOn: 'PR review' })])).toBe(true);
    expect(waitingOnPr(a, [item({ to: '4@r', summary: 'PR #3', state: 'done' })])).toBe(false);
    expect(waitingOnPr(a, [item({ to: '4@r', summary: 'Improve the preview page' })])).toBe(false);
    expect(waitingOnPr(a, [item({ to: 'other@r', summary: 'PR #3' })])).toBe(false);
    expect(whereabouts({ status: 'working', session: '4@r' }, [item({ to: '4@r', summary: 'PR #3' })])).toBe('desk');
  });

  test('the lounge has a seat for every agent, however many there are', () => {
    for (const n of [0, 5, 24, 26, 27, 60, 140]) {
      const crowd = Array.from({ length: n }, (_, i) => agent(String(i), 'big', `p${i % 7}`));
      layout = buildLayout(crowd);
      expect(layout.lounge.spots.length).toBeGreaterThanOrEqual(Math.max(n, 26));
      for (const spot of layout.lounge.spots) expect(inRoom('lounge', spot)).toBe(true);
      for (const spot of layout.review.spots) expect(inRoom('review', spot)).toBe(true);
      expect(new Set([...layout.lounge.spots, ...layout.review.spots].map(key)).size)
        .toBe(layout.lounge.spots.length + layout.review.spots.length);
      const lounge = layout.rooms.find((r) => r.id === 'lounge')!;
      expect(lounge.z + lounge.d).toBeLessThan(layout.depth / 2);

      // Everybody idle at once: all of them sit, nobody stands, nobody shares a seat.
      const now = locateAgents(crowd, [], layout, assignSeats(crowd, layout).seats);
      expect(now.size).toBe(n);
      expect([...now.values()].filter((s) => s.posture === 'stand')).toHaveLength(0);
      expect(new Set([...now.values()].map(key)).size).toBe(n);
    }
  });

  test('a crowd bigger than a hand-made lounge stands inside it without overlapping', () => {
    layout = buildLayout([]);
    const crowd = Array.from({ length: 40 }, (_, i) => agent(String(i), 'big', `p${i % 3}`));
    const now = locateAgents(crowd, [], layout, assignSeats(crowd, layout).seats);
    const standing = [...now.values()].filter((s) => s.posture === 'stand');
    expect(standing.length).toBe(40 - layout.lounge.spots.length);
    for (const s of standing) expect(inRoom('lounge', s)).toBe(true);
    expect(new Set([...now.values()].map(key)).size).toBe(40);
  });

  test('one agent going to work leaves everyone else where they sat', () => {
    const agents = Array.from({ length: 12 }, (_, i) => agent(String(i), 'r', `p${i % 4}`));
    layout = buildLayout(agents);
    const home = assignSeats(agents, layout).seats;
    const before = locateAgents(agents, [], layout, home);
    const after = locateAgents(agents.map((a) => (a.id === '3' ? { ...a, status: 'working' as const } : a)), [], layout, home);
    for (const a of agents) if (a.id !== '3') expect(after.get(a.id)).toEqual(before.get(a.id)!);
    expect(after.get('3')).toEqual(home.get('3')!);
  });

  test('walking into a room goes through its door', () => {
    layout = buildLayout([]);
    const glass = -layout.depth / 2 + 7;
    const lounge = layout.lounge.spots[0]!;
    const review = layout.review.spots[0]!;
    const path = route(lounge, review, layout);
    expect(path).toHaveLength(3);
    expect(path[0]!.x).toBe(-5);
    expect(path[0]!.z).toBeGreaterThan(glass);
    expect(path[1]!.z).toBeLessThan(glass);
    expect(route(lounge, layout.lounge.spots[5]!, layout)).toHaveLength(1);
  });

  test('teams are grouped by rig then pod, lead first', () => {
    const named = (name: string, rig: string, pod: string) => ({ ...agent(name, rig, pod), name });
    const teams = groupByTeam([
      named('build.site', 'growth', 'build'), named('orch.lead', 'growth', 'orch'), named('build.demo', 'growth', 'build'),
      named('queue.worker', 'kernel', 'queue'), named('advisor.lead', 'kernel', 'advisor'),
    ]);
    expect(teams.map((t) => t.rig)).toEqual(['growth', 'kernel']);
    expect(teams[0]!.lead?.name).toBe('orch.lead');
    expect(teams[0]!.pods.map((p) => p.pod)).toEqual(['orch', 'build']);
    expect(teams[0]!.pods[1]!.agents.map((a) => a.name)).toEqual(['build.demo', 'build.site']);
    expect(teams[1]!.lead?.name).toBe('advisor.lead');
    expect(isLead({ name: 'lead.planner', pod: 'lead' })).toBe(true);
    expect(isLead({ name: 'reach.leader', pod: 'reach' })).toBe(false);
  });
});

describe('behavior', () => {
  test('needs-input shows a readable reason and sorts first', () => {
    const b = behaviorFor({ status: 'needs-input', statusReason: 'permission_prompt' });
    expect(b).toEqual({ pose: 'alert', screenOn: true, bubble: 'Waiting for a permission' });
    expect(behaviorFor({ status: 'needs-input', statusReason: 'odd_new_reason' }).bubble).toBe('Odd new reason');
    const sorted = [agent('a', 'r', 'p', 'idle'), agent('b', 'r', 'p', 'needs-input'), agent('c', 'r', 'p', 'working')]
      .sort(byAttention).map((a) => a.id);
    expect(sorted).toEqual(['b', 'c', 'a']);
  });

  test('mock source notifies subscribers and records messages', async () => {
    const src = new MockSource();
    let calls = 0;
    const off = src.subscribe(() => calls++);
    src.setStatus('mock-1', 'needs-input', 'selection_prompt');
    off();
    src.setStatus('mock-1', 'idle');
    expect(calls).toBe(1);
    await src.sendMessage('x@demo', 'hi');
    expect(src.sent).toEqual([{ session: 'x@demo', text: 'hi' }]);
  });
});
