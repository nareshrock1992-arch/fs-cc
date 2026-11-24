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
  it('queue added / removed use the display name and the queue id', () => {
    expect(describeActivity({ action: 'QUEUE_CREATED', entity_id: 'sales@default', new_value: { display_name: 'Sales' } }))
      .toBe('Queue "Sales" (sales@default) added');
    expect(describeActivity({ action: 'QUEUE_DELETED', entity_id: 'sales@default', old_value: { display_name: 'Sales' } }))
      .toBe('Queue "Sales" (sales@default) removed');
  });
  it('queue change in the Queues page words, only what changed', () => {
    expect(describeActivity({ action: 'QUEUE_UPDATED', entity_id: 'sales@default',
      old_value: { display_name: 'Sales', strategy: 'ring-all', sla_seconds: 20, max_wait_time: 300, active: true },
      new_value: { display_name: 'Sales', strategy: 'top-down', sla_seconds: 30, max_wait_time: 0, active: false } }))
      .toBe('Queue "Sales" (sales@default) changed (call distribution: Ring All → Top Down (by tier); '
        + 'max wait: 300 s → no limit; service level target: 20 s → 30 s; active: yes → no)');
  });
  it('agents in a queue', () => {
    expect(describeActivity({ action: 'QUEUE_AGENT_ADDED', entity_id: 'sales@default',
      new_value: { agent_id: 'alice@default', level: 1, position: 2 } }))
      .toBe('Agent alice@default added to queue sales@default (level 1, position 2)');
    expect(describeActivity({ action: 'QUEUE_AGENT_UPDATED', entity_id: 'sales@default',
      old_value: { agent_id: 'alice@default', level: 1, position: 2 }, new_value: { agent_id: 'alice@default', level: 3, position: 2 } }))
      .toBe('Agent alice@default in queue sales@default: level 1, position 2 → level 3, position 2');
    expect(describeActivity({ action: 'QUEUE_AGENT_STATE_SET', entity_id: 'sales@default',
      new_value: { agent_id: 'alice@default', state: 'Standby' } }))
      .toBe('Agent alice@default in queue sales@default set to "Standby"');
    expect(describeActivity({ action: 'QUEUE_AGENT_REMOVED', entity_id: 'sales@default',
      old_value: { agent_id: 'alice@default', level: 1, position: 2 } }))
      .toBe('Agent alice@default removed from queue sales@default');
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
