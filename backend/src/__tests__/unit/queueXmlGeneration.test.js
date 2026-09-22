/**
 * Phase 5 — queueXml.generateCallcenterXml() emits DB-driven agent/queue config:
 *   fs_agent_type, no-answer-delay-time, queue agent-no-answer-status, contact
 *   (which already carries leg_timeout from Phase 4), and tiers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../../db/pool.js', () => ({ query }));
vi.mock('../../../services/eslService.js', () => ({ eslApi: vi.fn() }));
vi.mock('../../../config/index.js', () => ({ config: { fs: { confPath: null } } }));

const { generateCallcenterXml } = await import('../../../utils/queueXml.js');

beforeEach(() => query.mockReset());

describe('generateCallcenterXml — DB-driven', () => {
  it('emits fs_agent_type, no-answer-delay-time, queue agent-no-answer-status, contact, tiers', async () => {
    query
      .mockResolvedValueOnce({ rows: [ // queues
        { name: 'support@default', strategy: 'longest-idle-agent', moh_sound: 'local_stream://moh',
          max_wait_time: 300, max_wait_time_w_no_agent: 0, max_queue_size: 50, agent_no_answer_status: 'Logged Out' } ] })
      .mockResolvedValueOnce({ rows: [ // agents
        { agent_id: 'agent_1001', fs_agent_type: 'uuid-standby',
          contact: '{sip_cid_type=pid,leg_timeout=15}user/1001@d', wrap_up_time: 20, max_no_answer: 3,
          reject_delay_time: 2, busy_delay_time: 60, no_answer_delay_time: 7 } ] })
      .mockResolvedValueOnce({ rows: [ // tiers
        { agent_id: 'agent_1001', queue_name: 'support@default', level: 1, position: 2 } ] });

    const xml = await generateCallcenterXml();

    expect(xml).toContain('type="uuid-standby"');
    expect(xml).toContain('no-answer-delay-time="7"');
    expect(xml).toContain('contact="{sip_cid_type=pid,leg_timeout=15}user/1001@d"');
    expect(xml).toContain('<param name="agent-no-answer-status"            value="Logged Out"/>');
    expect(xml).toContain('<tier agent="agent_1001" queue="support@default" level="1" position="2"/>');
  });

  it('falls back to safe defaults when optional fields are null', async () => {
    query
      .mockResolvedValueOnce({ rows: [ { name: 'q@d', strategy: 's', moh_sound: null, max_wait_time: 10,
        max_wait_time_w_no_agent: 0, max_queue_size: 50, agent_no_answer_status: null } ] })
      .mockResolvedValueOnce({ rows: [ { agent_id: 'a1', fs_agent_type: null, contact: '{sip_cid_type=pid}user/1@d',
        wrap_up_time: 20, max_no_answer: 3, reject_delay_time: 2, busy_delay_time: 60, no_answer_delay_time: null } ] })
      .mockResolvedValueOnce({ rows: [] });

    const xml = await generateCallcenterXml();
    expect(xml).toContain('type="callback"');                 // fs_agent_type null → callback
    expect(xml).toContain('no-answer-delay-time="10"');       // null → default 10
    expect(xml).toContain('value="On Break"');                // agent_no_answer_status null → On Break
  });
});
