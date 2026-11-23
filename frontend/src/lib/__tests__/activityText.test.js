import { describe, expect, it } from 'vitest';
import { describeActivity } from '../activityText.js';

describe('Activity log sentences (plain words, not field names)', () => {
  it('agent status with before and after', () => {
    expect(describeActivity({ action: 'AGENT_STATUS_SET', entity_id: 'sunday@default',
      old_value: { status: 'Available' }, new_value: { status: 'On Break' } }))
      .toBe('Agent sunday@default set to On Break (was Available)');
  });
  it('updates list only real changes, never bookkeeping columns', () => {
    const s = describeActivity({ action: 'BREAK_CODE_UPDATED', entity_id: 'LUNCH',
      old_value: { name: 'Lunch', max_duration_seconds: 1800, updated_at: 'a', id: 1 },
      new_value: { name: 'Lunch', max_duration_seconds: 2700, updated_at: 'b', id: 1 } });
    expect(s).toBe('Break code "Lunch" changed (max duration seconds: 1800 → 2700)');
  });
  it('permissions in admin words', () => {
    expect(describeActivity({ action: 'USER_PERMISSIONS_SET', entity_id: 'sup1',
      new_value: { permissions: ['view_reports', 'view_activity_log'] } }))
      .toBe('User sup1 may now: view reports, view activity log');
  });
  it('queue outcome list: empty list means all active outcomes', () => {
    expect(describeActivity({ action: 'QUEUE_DISPOSITIONS_SET', entity_id: 'support@default', new_value: { code_ids: [] } }))
      .toBe('Queue support@default now offers: all active outcomes');
    expect(describeActivity({ action: 'QUEUE_DISPOSITIONS_SET', entity_id: 'support@default', new_value: { code_ids: [3, 5] } }))
      .toBe('Queue support@default now offers: 2 chosen outcomes');
  });
  it('supervisor force hang-up', () => {
    expect(describeActivity({ action: 'force_hangup', entity_type: 'call', new_value: { agent_id: 'sunday@default' }, result: 'ok' }))
      .toBe('Ended a call of agent sunday@default (force hang-up)');
  });
  it('unknown actions still read as words', () => {
    expect(describeActivity({ action: 'QUEUE_TIER_ADDED', entity_type: 'queue', entity_id: 'q1' }))
      .toBe('Queue tier added — queue q1');
    expect(describeActivity({})).toBe('Change');
  });
});
