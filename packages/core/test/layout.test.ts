import { describe, expect, test } from 'bun:test';
import {
  assignSeats, behaviorFor, byAttention, defaultLayout, desksForZone, groupByTeam, isLead, litDesks, locateAgents,
  MockSource, route, waitingOnPr, whereabouts,
} from '../src/index.ts';
import type { Agent, QueueItem } from '../src/index.ts';

const agent = (id: string, rig: string, pod: string, status: Agent['status'] = 'idle'): Agent => ({
  id, name: `${pod}.${id}`, session: `${id}@${rig}`, rig, pod, kind: 'agent', runtime: 't', model: null,
  status, statusReason: null, lastActivityAt: null,
  work: { assigned: 0, pending: 0, inProgress: 0, blocked: 0 }, contextUsedPct: null,
});

describe('layout', () => {
  const layout = defaultLayout();

  test('every zone bench has distinct desks inside the building', () => {
    for (const zone of layout.zones) {
      const desks = desksForZone(zone);
      expect(desks).toHaveLength(zone.seats);
      expect(new Set(desks.map((d) => `${d.x},${d.z}`)).size).toBe(zone.seats);
      for (const d of desks) {
        expect(Math.abs(d.x)).toBeLessThan(layout.width / 2);
        expect(Math.abs(d.z)).toBeLessThan(layout.depth / 2);
      }
    }
  });

  test('each pod gets its own bench and the kernel rig gets the glass room', () => {
    const agents = [
      agent('1', 'growth', 'orch'), agent('2', 'growth', 'build'), agent('3', 'growth', 'build'),
      agent('4', 'growth', 'market'), agent('5', 'growth', 'market'),
      agent('6', 'growth', 'reach'), agent('7', 'growth', 'reach'), agent('8', 'growth', 'reach'),
      agent('9', 'kernel', 'operator'), agent('10', 'kernel', 'queue'),
    ];
    const { seats, zoneLabels } = assignSeats(agents, layout);
    expect(seats.size).toBe(agents.length);
    expect(new Set([...seats.values()].map((s) => s.deskId)).size).toBe(agents.length);
    expect(seats.get('9')!.zoneId).toBe('kernel');
    expect(seats.get('10')!.zoneId).toBe('kernel');
    const zoneOf = (pod: string) => new Set(agents.filter((a) => a.pod === pod).map((a) => seats.get(a.id)!.zoneId));
    for (const pod of ['orch', 'build', 'market', 'reach']) expect(zoneOf(pod).size).toBe(1);
    expect(new Set(['orch', 'build', 'market', 'reach'].map((p) => [...zoneOf(p)][0])).size).toBe(4);
    expect(zoneLabels.get('kernel')).toEqual(['operator', 'queue']);
  });

  test('a status change does not move anyone', () => {
    const before = [agent('1', 'r', 'a'), agent('2', 'r', 'b'), agent('3', 'r', 'b')];
    const after = before.map((a) => ({ ...a, status: 'working' as const })).reverse();
    expect([...assignSeats(after, layout).seats.entries()].sort())
      .toEqual([...assignSeats(before, layout).seats.entries()].sort());
  });

  test('agents beyond the last desk stand in the overflow area instead of vanishing', () => {
    const crowd = Array.from({ length: 30 }, (_, i) => agent(String(i), 'big', `p${i % 3}`));
    const { seats } = assignSeats(crowd, layout);
    expect(seats.size).toBe(30);
    const standing = [...seats.values()].filter((s) => s.deskId === null);
    expect(standing.length).toBe(30 - 20);
    expect(new Set(standing.map((s) => `${s.x},${s.z}`)).size).toBe(standing.length);
  });
});

describe('where agents are', () => {
  const layout = defaultLayout();
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

  test('the lounge seats a full office, and a bigger crowd stands without overlapping', () => {
    const desks = layout.zones.reduce((n, zone) => n + zone.seats, 0);
    expect(layout.lounge.spots.length).toBeGreaterThanOrEqual(desks);
    for (const spot of layout.lounge.spots) expect(inRoom('lounge', spot)).toBe(true);
    for (const spot of layout.review.spots) expect(inRoom('review', spot)).toBe(true);
    expect(new Set([...layout.lounge.spots, ...layout.review.spots].map(key)).size)
      .toBe(layout.lounge.spots.length + layout.review.spots.length);

    const crowd = Array.from({ length: 30 }, (_, i) => agent(String(i), 'big', `p${i % 3}`));
    const now = locateAgents(crowd, [], layout, assignSeats(crowd, layout).seats);
    expect(now.size).toBe(30);
    const standing = [...now.values()].filter((s) => s.posture === 'stand');
    expect(standing.length).toBe(30 - layout.lounge.spots.length);
    for (const s of standing) expect(inRoom('lounge', s)).toBe(true);
    expect(new Set([...now.values()].map(key)).size).toBe(30);
  });

  test('one agent going to work leaves everyone else where they sat', () => {
    const agents = Array.from({ length: 12 }, (_, i) => agent(String(i), 'r', `p${i % 4}`));
    const home = assignSeats(agents, layout).seats;
    const before = locateAgents(agents, [], layout, home);
    const after = locateAgents(agents.map((a) => (a.id === '3' ? { ...a, status: 'working' as const } : a)), [], layout, home);
    for (const a of agents) if (a.id !== '3') expect(after.get(a.id)).toEqual(before.get(a.id)!);
    expect(after.get('3')).toEqual(home.get('3')!);
  });

  test('walking into a room goes through its door', () => {
    const lounge = layout.lounge.spots[0]!;
    const review = layout.review.spots[0]!;
    const path = route(lounge, review, layout);
    expect(path).toHaveLength(3);
    expect(path[0]!.x).toBe(-5);
    expect(path[0]!.z).toBeGreaterThan(-7);
    expect(path[1]!.z).toBeLessThan(-7);
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
