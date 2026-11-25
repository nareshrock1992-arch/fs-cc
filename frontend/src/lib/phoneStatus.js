// Browser-phone status shown next to the agent status (owner 2026-11-25).
// null = the agent does not use the browser phone → nothing is shown.

const VIEWS = {
  online:  { tone: 'ok',    label: 'Phone registered',     title: 'Browser phone signed in to the phone system; calls can ring.' },
  grace:   { tone: 'warn',  label: 'Phone reconnecting',   title: 'Browser phone lost its connection a moment ago and is reconnecting. Calls in progress are not ended.' },
  offline: { tone: 'bad',   label: 'Phone offline',        title: 'Browser phone is not connected. The agent is put on the "Phone offline" break and gets no calls.' },
  none:    { tone: 'muted', label: 'Phone not signed in',  title: 'The agent has not signed in to the browser phone in the Agent Desktop.' },
};

/** View for a phone_status value, or null when nothing should be shown. */
export function phoneStatusView(status) {
  if (status == null) return null;
  return VIEWS[status] || VIEWS.none;
}

/** Apply a live 'agent:phone' event ({ agentId, phone }) to a list of agents. */
export function applyPhoneEvent(agents, evt) {
  if (!evt?.agentId || !Array.isArray(agents)) return agents;
  let changed = false;
  const next = agents.map((a) => {
    if (a.agent_id !== evt.agentId || a.phone_status == null || a.phone_status === evt.phone) return a;
    changed = true;
    return { ...a, phone_status: evt.phone };
  });
  return changed ? next : agents;
}
