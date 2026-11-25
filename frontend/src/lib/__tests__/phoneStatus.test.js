import { describe, expect, it } from 'vitest';
import { phoneStatusView, applyPhoneEvent } from '../phoneStatus.js';

describe('browser phone status view', () => {
  it('desk-phone agents (null) show nothing; unknown values read as not signed in', () => {
    expect(phoneStatusView(null)).toBeNull();
    expect(phoneStatusView(undefined)).toBeNull();
    expect(phoneStatusView('online')).toMatchObject({ tone: 'ok', label: 'Phone registered' });
    expect(phoneStatusView('grace')).toMatchObject({ tone: 'warn', label: 'Phone reconnecting' });
    expect(phoneStatusView('offline')).toMatchObject({ tone: 'bad', label: 'Phone offline' });
    expect(phoneStatusView('weird')).toMatchObject({ label: 'Phone not signed in' });
  });
});

describe('live agent:phone events', () => {
  const agents = [
    { agent_id: 'wednesday@default', phone_status: 'online' },
    { agent_id: 'sunday@default', phone_status: null },
  ];
  it('updates only the browser-phone agent named in the event', () => {
    const next = applyPhoneEvent(agents, { agentId: 'wednesday@default', phone: 'grace' });
    expect(next.map((a) => a.phone_status)).toEqual(['grace', null]);
    expect(agents[0].phone_status).toBe('online');                       // no mutation
  });
  it('never turns a desk-phone agent into a browser-phone agent; no change → same list', () => {
    expect(applyPhoneEvent(agents, { agentId: 'sunday@default', phone: 'online' })).toBe(agents);
    expect(applyPhoneEvent(agents, { agentId: 'wednesday@default', phone: 'online' })).toBe(agents);
    expect(applyPhoneEvent(agents, null)).toBe(agents);
  });
});
