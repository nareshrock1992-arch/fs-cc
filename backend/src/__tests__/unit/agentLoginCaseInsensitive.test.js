/**
 * Case-insensitive Agent Desktop login (agentDeskController.agentLogin).
 *
 * Verifies that an agent authenticates with any casing of their stored agent_id
 * (trimmed), that the lookup is normalized with LOWER(agent_id)=LOWER($1), and
 * that EVERY downstream identity (JWT claim, session, response) uses the exact
 * STORED canonical agent_id — never the casing the user typed. pg/bcrypt/jwt are
 * mocked (repo convention), so this is a behavioral/shape test, not a real DB.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/agentLoginCaseInsensitive.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/index.js', () => ({ config: { jwt: { secret: 'test' } } }));
vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({
  cc: {}, isConnected: vi.fn(() => true),
}));
vi.mock('../../../services/agentSessionService.js', () => ({
  startLoginSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn() } }));
vi.mock('jsonwebtoken', () => ({ default: { sign: vi.fn(() => 'signed.jwt.token') } }));

import { query } from '../../../db/pool.js';
import * as agentSession from '../../../services/agentSessionService.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { agentLogin } from '../../../controllers/agentDeskController.js';

// Canonical stored row — note the stored casing is "Agent1@default.com".
const CANONICAL = 'Agent1@default.com';
const row = () => ({
  id: 1, agent_id: CANONICAL, full_name: 'Agent One', avaya_extension: '1001',
  contact: 'user/1001', status: 'Logged Out', state: 'Waiting', pin_hash: '$hash',
});

function makeRes() {
  return {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b)   { this.body = b; return this; },
  };
}
const req = (agent_id, pin = '1234') => ({ body: { agent_id, pin } });

beforeEach(() => {
  vi.clearAllMocks();
  bcrypt.compare.mockResolvedValue(true);
});

describe('agentLogin — case-insensitive lookup', () => {
  for (const [label, input] of [
    ['exact case',  'Agent1@default.com'],
    ['lowercase',   'agent1@default.com'],
    ['uppercase',   'AGENT1@DEFAULT.COM'],
    ['mixed case',  'Agent1@Default.com'],
    ['surrounding spaces', '  AGENT1@Default.com  '],
  ]) {
    it(`authenticates with ${label} + correct PIN`, async () => {
      query.mockResolvedValueOnce({ rows: [row()] }); // LOWER() match returns canonical
      const res = makeRes();
      await agentLogin(req(input), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.token).toBe('signed.jwt.token');
      // Response carries the STORED canonical id, not the submitted casing.
      expect(res.body.agent.agent_id).toBe(CANONICAL);

      // Lookup is case-insensitive and parameterized with the TRIMMED input.
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/LOWER\(agent_id\)\s*=\s*LOWER\(\$1\)/i);
      expect(params[0]).toBe(input.trim());

      // Downstream identity uses the canonical stored id.
      expect(agentSession.startLoginSession).toHaveBeenCalledWith(CANONICAL);
      expect(jwt.sign.mock.calls[0][0]).toMatchObject({ agentId: CANONICAL, role: 'agent' });
    });
  }
});

describe('agentLogin — rejections', () => {
  it('rejects a valid id with an incorrect PIN', async () => {
    query.mockResolvedValueOnce({ rows: [row()] });
    bcrypt.compare.mockResolvedValueOnce(false);
    const res = makeRes();
    await agentLogin(req('agent1@default.com', 'wrong'), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(agentSession.startLoginSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown id', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await agentLogin(req('nobody@nowhere.com'), res);
    expect(res.statusCode).toBe(401);
  });

  it('preserves existing validation for an empty id', async () => {
    const res = makeRes();
    await agentLogin(req('', '1234'), res);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('does NOT silently authenticate an ambiguous case-only duplicate', async () => {
    // Two rows differing only by case → must reject, not pick one.
    query.mockResolvedValueOnce({ rows: [row(), { ...row(), id: 2, agent_id: 'agent1@default.com' }] });
    const res = makeRes();
    await agentLogin(req('AGENT1@DEFAULT.COM'), res);
    expect(res.statusCode).toBe(401);
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(agentSession.startLoginSession).not.toHaveBeenCalled();
  });
});
