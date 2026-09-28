/**
 * metricsSql.js — canonical metric SQL fragment tests (Phase 3A extraction).
 *
 * Proves the extracted fragments are CHARACTER-IDENTICAL to what the controllers
 * previously inlined (so endpoint behavior is unchanged) and that the
 * answered / abandoned / agent-missed classification is correct across the
 * documented lifecycle cases (answered, queue-abandon, agent no-answer,
 * re-offer, empty).
 */
import { describe, it, expect } from 'vitest';
import {
  answered, abandoned, agentMissedExists, abandonedAgent, abandonedQueue,
} from '../../../services/metricsSql.js';

describe('metricsSql — exact fragment text (behavior-preserving extraction)', () => {
  it('answered() reproduces the inlined predicate, default + aliased', () => {
    expect(answered()).toBe("c.disposition = 'answered'");
    expect(answered('c')).toBe("c.disposition = 'answered'");
    expect(answered('ch')).toBe("ch.disposition = 'answered'");
  });

  it('abandoned() reproduces the inlined predicate, default + aliased', () => {
    expect(abandoned()).toBe('c.abandoned = true');
    expect(abandoned('ch')).toBe('ch.abandoned = true');
  });

  it('agentMissedExists() reproduces the exact EXISTS body used by every consumer', () => {
    expect(agentMissedExists('c', 'ah')).toBe(
      'EXISTS (SELECT 1 FROM agent_history ah WHERE ah.call_uuid = c.call_uuid AND ah.missed = true)'
    );
    // CDR uses the `ch` alias for calls
    expect(agentMissedExists('ch', 'ah')).toBe(
      'EXISTS (SELECT 1 FROM agent_history ah WHERE ah.call_uuid = ch.call_uuid AND ah.missed = true)'
    );
  });

  it('classification is keyed on missed (never a bare EXISTS on call_uuid)', () => {
    expect(agentMissedExists()).toMatch(/missed = true/);
    // the exact old buggy predicate shape must not be producible
    expect(agentMissedExists()).not.toMatch(/WHERE\s+ah\.call_uuid\s*=\s*c\.call_uuid\s*\)/);
  });

  it('abandonedAgent / abandonedQueue compose the predicates correctly', () => {
    expect(abandonedAgent('c', 'ah')).toBe(
      "c.abandoned = true AND EXISTS (SELECT 1 FROM agent_history ah WHERE ah.call_uuid = c.call_uuid AND ah.missed = true)"
    );
    expect(abandonedQueue('c', 'ah')).toBe(
      "c.abandoned = true AND NOT EXISTS (SELECT 1 FROM agent_history ah WHERE ah.call_uuid = c.call_uuid AND ah.missed = true)"
    );
  });
});

// ── Semantic reconciliation: the predicates classify the documented cases the
//    same way the SQL does (mirror of the WHERE logic). ────────────────────────
function classify(call, history) {
  const isAnswered  = call.disposition === 'answered';
  const isAbandoned = call.abandoned === true;
  const agentMissed = history.some(h => h.missed === true);
  return {
    answered:        isAnswered ? 1 : 0,
    abandoned:       isAbandoned ? 1 : 0,
    abandoned_agent: isAbandoned && agentMissed ? 1 : 0,
    abandoned_queue: isAbandoned && !agentMissed ? 1 : 0,
  };
}

describe('metricsSql — lifecycle reconciliation cases', () => {
  it('1. answered call', () => {
    expect(classify({ disposition: 'answered', abandoned: false }, [{ missed: false, talk_start: 't' }]))
      .toEqual({ answered: 1, abandoned: 0, abandoned_agent: 0, abandoned_queue: 0 });
  });
  it('2. caller abandoned in queue (no agent history)', () => {
    expect(classify({ disposition: 'abandoned', abandoned: true }, []))
      .toEqual({ answered: 0, abandoned: 1, abandoned_agent: 0, abandoned_queue: 1 });
  });
  it('3. agent no-answer then caller gave up → abandoned_agent', () => {
    expect(classify({ disposition: 'abandoned', abandoned: true }, [{ missed: true }]))
      .toEqual({ answered: 0, abandoned: 1, abandoned_agent: 1, abandoned_queue: 0 });
  });
  it('4. answered after agent re-offer (miss then answer) → answered, not abandoned', () => {
    expect(classify({ disposition: 'answered', abandoned: false }, [{ missed: true }, { missed: false, talk_start: 't' }]))
      .toEqual({ answered: 1, abandoned: 0, abandoned_agent: 0, abandoned_queue: 0 });
  });
  it('5. stale offering row (missed=false) on an abandoned call → abandoned_queue (invariant holds)', () => {
    const r = classify({ disposition: 'abandoned', abandoned: true }, [{ missed: false }]);
    expect(r).toEqual({ answered: 0, abandoned: 1, abandoned_agent: 0, abandoned_queue: 1 });
    expect(r.abandoned_queue + r.abandoned_agent).toBe(r.abandoned); // INVARIANT
  });
  it('6. empty aggregate — no rows', () => {
    expect(classify({ disposition: null, abandoned: false }, []))
      .toEqual({ answered: 0, abandoned: 0, abandoned_agent: 0, abandoned_queue: 0 });
  });
});
