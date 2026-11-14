import { describe, expect, test } from 'bun:test';
import { assignSeats, behaviorFor, byAttention, defaultLayout, desksForZone, MockSource } from '../src/index.ts';
import type { Agent } from '../src/index.ts';

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
