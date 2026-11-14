// BUG-007: supervisor force hang-up of a call stuck in FreeSWITCH.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const eslApi = vi.fn();
const agentList = vi.fn();
vi.mock('../../../db/pool.js', () => ({ query }));
vi.mock('../../../services/eslService.js', () => ({ eslApi, cc: { agentList } }));

const { channelsForCall, isUuid, forceHangup } = await import('../../../controllers/callControlController.js');

const CALL = 'ab3bffe7-20c2-474c-a3a8-0926e49b5d74';
const CUST = '5bdcbcf7-d9df-42c2-af0d-627bfe580c71';
const AGENT_LEG = '724e107e-05ec-4f8d-b242-97fe0da4ce27';
const res = () => { const r = {}; r.status = vi.fn(() => r); r.json = vi.fn(() => r); return r; };

describe('channelsForCall', () => {
  it('customer channel + agent leg, de-duplicated, UUIDs only', () => {
    expect(channelsForCall({ vdn: CUST }, { uuid: AGENT_LEG })).toEqual([CUST, AGENT_LEG]);
    expect(channelsForCall({ vdn: CUST }, { uuid: CUST })).toEqual([CUST]);
    expect(channelsForCall({ vdn: 'x; shutdown' }, { uuid: '' })).toEqual([]);
    expect(isUuid('724e107e-05ec-4f8d-b242-97fe0da4ce27 && reloadxml')).toBe(false);
  });
});

describe('forceHangup', () => {
  beforeEach(() => { query.mockReset(); eslApi.mockReset(); agentList.mockReset(); });

  it('rejects a malformed call id before touching ESL', async () => {
    const r = res();
    await forceHangup({ params: { callUuid: 'bad' }, user: { username: 'sup' } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(eslApi).not.toHaveBeenCalled();
  });

  it('404 for an unknown call', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = res();
    await forceHangup({ params: { callUuid: CALL }, user: { username: 'sup' } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });

  it('kills the customer channel and the agent leg, and writes an audit row', async () => {
    query.mockResolvedValueOnce({ rows: [{ call_uuid: CALL, vdn: CUST, agent_id: 'wednesday@default' }] })
         .mockResolvedValueOnce({ rows: [] });
    agentList.mockResolvedValue([{ name: 'wednesday@default', uuid: AGENT_LEG }]);
    eslApi.mockResolvedValue('+OK');
    const r = res();
    await forceHangup({ params: { callUuid: CALL }, user: { username: 'sup' } }, r);
    expect(eslApi.mock.calls.map((c) => c[0])).toEqual([
      `uuid_kill ${CUST} NORMAL_CLEARING`, `uuid_kill ${AGENT_LEG} NORMAL_CLEARING`]);
    const audit = query.mock.calls[1];
    expect(audit[0]).toMatch(/INSERT INTO supervisor_actions/);
    expect(audit[1]).toEqual([CALL, 'wednesday@default', [CUST, AGENT_LEG], expect.any(String), 'sup']);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ channels: [CUST, AGENT_LEG] }));
  });
});
