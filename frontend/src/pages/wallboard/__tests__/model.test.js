import { describe, expect, it } from 'vitest';
import { selectQueues, agentsForQueues, wallboardTiles, slBand, mmss } from '../model.js';
import { overallServiceLevel } from '../../liveops/model.js';

const Q = [
  { queue_name: 'sales@d', waiting: 2, longest_wait_seconds: 48, answered_today: 4, abandoned_today: 2, sla_pct_today: '50.0', avg_wait_today: 10 },
  { queue_name: 'help@d',  waiting: 1, longest_wait_seconds: 90, answered_today: 0, abandoned_today: 0, sla_pct_today: null, avg_wait_today: 0 },
];
const A = [
  { operational_state: 'Idle',     queues: [{ queue: 'sales@d' }] },
  { operational_state: 'On Call',  queues: [{ queue: 'sales@d' }] },
  { operational_state: 'Ringing',  queues: [{ queue: 'help@d' }] },
  { operational_state: 'On Break', queues: [{ queue: 'help@d' }] },
  { operational_state: 'Idle',     queues: [{ queue: 'other@d' }] },
];

describe('wallboard model', () => {
  it('no choice or a stale choice shows all queues', () => {
    expect(selectQueues(Q, []).length).toBe(2);
    expect(selectQueues(Q, ['gone@d']).length).toBe(2);
    expect(selectQueues(Q, ['help@d']).map((q) => q.queue_name)).toEqual(['help@d']);
  });
  it('agents are counted only for the shown queues', () => {
    expect(agentsForQueues(A, [Q[0]]).length).toBe(2);
    expect(agentsForQueues(A, Q).length).toBe(4);
  });
  it('tiles: live numbers, one-decimal service level, ringing counts as on call', () => {
    const t = wallboardTiles({ queues: Q, agents: agentsForQueues(A, Q), phoneOnline: true });
    expect(t).toMatchObject({ waiting: 3, longestWaitSeconds: 90, serviceLevel: 50, answered: 4, abandoned: 2,
      avgWaitSeconds: 10, agentsReady: 1, agentsOnCall: 2, agentsOnBreak: 1 });
  });
  it('phone system offline: live numbers unknown, today totals still shown', () => {
    const t = wallboardTiles({ queues: Q, agents: A, phoneOnline: false });
    expect(t.waiting).toBeNull();
    expect(t.longestWaitSeconds).toBeNull();
    expect(t.agentsReady).toBeNull();
    expect(t.agentsOnCall).toBeNull();
    expect(t.answered).toBe(4);
    expect(t.serviceLevel).toBe(50);
  });
  it('service level bands and m:ss', () => {
    expect([slBand(85), slBand(70), slBand(10), slBand(null)]).toEqual(['good', 'warn', 'bad', 'none']);
    expect([mmss(48), mmss(90), mmss(null)]).toEqual(['0:48', '1:30', '—']);
  });
  it('overall service level keeps one decimal (owner decision)', () => {
    expect(overallServiceLevel([
      { answered_today: 2, abandoned_today: 1, sla_pct_today: '66.7' },
      { answered_today: 0, abandoned_today: 0, sla_pct_today: null },
    ])).toBe(66.7);
    expect(overallServiceLevel([])).toBeNull();
  });
});
