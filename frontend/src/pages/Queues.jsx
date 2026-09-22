import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Users2, X, Layers } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { Queues as QueuesApi, Agents as AgentsApi } from '../api/client.js';
import Panel from '../components/Panel.jsx';
import Modal from '../components/Modal.jsx';
import StatusLamp from '../components/StatusLamp.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { FormField, inputClass, buttonPrimary, buttonSecondary } from '../components/form.jsx';

const STRATEGIES = [
  { value: 'longest-idle-agent',          label: 'Longest Idle Agent' },
  { value: 'agent-with-least-talk-time',  label: 'Least Talk Time' },
  { value: 'round-robin',                 label: 'Round Robin' },
  { value: 'top-down',                    label: 'Top Down (by tier)' },
  { value: 'ring-all',                    label: 'Ring All' }
];

const EMPTY_FORM = { name: '', displayName: '', strategy: 'longest-idle-agent', maxWaitTime: 300, maxQueueSize: 50, agentNoAnswerStatus: 'On Break' };

// Queue auto-action after max-no-answer → mod_callcenter agent-no-answer-status.
const NO_ANSWER_STATUSES = ['Available', 'On Break', 'Logged Out'];
// Admin-settable mod_callcenter tier states (UNVERIFIED vs installed FS version).
const TIER_STATES = ['Ready', 'Standby', 'No Answer'];

export default function Queues() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [queues, setQueues]       = useState([]);
  const [allAgents, setAllAgents] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingName, setEditingName] = useState(null);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState(null);

  const [tierQueue, setTierQueue]         = useState(null);
  const [tierAgentToAdd, setTierAgentToAdd] = useState('');
  const [tierError, setTierError]         = useState(null);

  const load = useCallback(async () => {
    try {
      const [q, a] = await Promise.all([QueuesApi.list(), AgentsApi.list()]);
      setQueues(q);
      setAllAgents(a);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditingName(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(q) {
    setEditingName(q.name);
    setForm({ name: q.name, displayName: q.display_name, strategy: q.strategy,
              maxWaitTime: q.max_wait_time, maxQueueSize: q.max_queue_size,
              agentNoAnswerStatus: q.agent_no_answer_status || 'On Break' });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editingName) {
        await QueuesApi.update(editingName, form);
      } else {
        await QueuesApi.create(form);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(name) {
    if (!window.confirm(`Delete queue "${name}"? Agents will be unassigned.`)) return;
    await QueuesApi.remove(name);
    await load();
  }

  async function openTiers(queueName) {
    const detail = await QueuesApi.get(queueName);
    setTierQueue(detail);
    setTierAgentToAdd('');
  }

  async function handleAddTier() {
    if (!tierAgentToAdd) return;
    await QueuesApi.addTier(tierQueue.name, { agentId: tierAgentToAdd, level: 1, position: 1 });
    const refreshed = await QueuesApi.get(tierQueue.name);
    setTierQueue(refreshed);
    setTierAgentToAdd('');
    load();
  }

  async function handleRemoveTier(agentId) {
    await QueuesApi.removeTier(tierQueue.name, agentId);
    const refreshed = await QueuesApi.get(tierQueue.name);
    setTierQueue(refreshed);
    load();
  }

  // Change tier level / position / state for one agent. state is runtime-only
  // (applied to FreeSWITCH, not persisted). Surfaces FreeSWITCH sync failures.
  async function handleSetTier(agentId, payload) {
    try {
      const r = await QueuesApi.setTier(tierQueue.name, agentId, payload);
      if (r && r.fs_synced === false) {
        setTierError(`Saved in DB, but FreeSWITCH did not sync: ${r.fs_error || 'unknown error'}`);
      } else {
        setTierError(null);
      }
    } catch (err) {
      setTierError(err.response?.data?.error || err.message);
    }
    const refreshed = await QueuesApi.get(tierQueue.name);
    setTierQueue(refreshed);
    load();
  }

  const availableToAdd = tierQueue
    ? allAgents.filter((a) => !tierQueue.agents.some((t) => t.agent_id === a.agent_id))
    : [];

  const thClass = 'pb-2.5 font-display font-medium dark:text-ink-faint text-gray-400 text-[11px] uppercase tracking-widest';

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <button onClick={openCreate} className={buttonPrimary}>
            <Plus size={15} /> Add Queue
          </button>
        </div>
      )}

      <Panel>
        {loading && <p className="text-sm dark:text-ink-dim text-gray-500">Loading queues…</p>}
        {error   && <p className="text-sm text-lamp-alert">{error}</p>}
        {!loading && !error && queues.length === 0 && (
          <EmptyState icon={Layers} title="No queues configured yet" body="Add a queue to start routing calls." />
        )}
        {!loading && !error && queues.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className={`text-left border-b dark:border-panel-border border-gray-100`}>
                <th className={thClass}>Queue</th>
                <th className={thClass}>Strategy</th>
                <th className={thClass}>Max Wait</th>
                <th className={thClass}>Max Size</th>
                {isAdmin && <th className={`${thClass} text-right`}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr key={q.name} className="border-b dark:border-panel-border/60 border-gray-50 last:border-0">
                  <td className="py-3">
                    <p className="font-medium dark:text-ink text-gray-800">{q.display_name}</p>
                    <p className="text-[11px] dark:text-ink-faint text-gray-400 font-mono">{q.name}</p>
                  </td>
                  <td className="py-3 dark:text-ink-dim text-gray-500">
                    {STRATEGIES.find((s) => s.value === q.strategy)?.label || q.strategy}
                  </td>
                  <td className="py-3 font-mono tnum dark:text-ink-dim text-gray-500">{q.max_wait_time}s</td>
                  <td className="py-3 font-mono tnum dark:text-ink-dim text-gray-500">{q.max_queue_size}</td>
                  {isAdmin && (
                    <td className="py-3">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => openTiers(q.name)}
                          className="p-1.5 rounded-lg dark:text-ink-dim text-gray-400 hover:text-gray-800 dark:hover:text-ink hover:bg-gray-100 dark:hover:bg-panel-raised transition-colors"
                          title="Manage agents">
                          <Users2 size={14} />
                        </button>
                        <button onClick={() => openEdit(q)}
                          className="p-1.5 rounded-lg dark:text-ink-dim text-gray-400 hover:text-gray-800 dark:hover:text-ink hover:bg-gray-100 dark:hover:bg-panel-raised transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDelete(q.name)}
                          className="p-1.5 rounded-lg dark:text-ink-dim text-gray-400 hover:text-lamp-alert hover:bg-lamp-alert/10 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* Create / edit queue modal (admin only) */}
      {isAdmin && <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingName ? `Edit ${editingName}` : 'Add Queue'}
        footer={
          <>
            <button className={buttonSecondary} onClick={() => setModalOpen(false)}>Cancel</button>
            <button className={buttonPrimary} form="queue-form" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Queue'}
            </button>
          </>
        }
      >
        <form id="queue-form" onSubmit={handleSave}>
          {formError && <p className="text-sm text-lamp-alert mb-4">{formError}</p>}
          <FormField label="Queue Name" hint="FreeSWITCH queue identifier, e.g. support@default">
            <input required disabled={Boolean(editingName)} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass} placeholder="support@default" />
          </FormField>
          <FormField label="Display Name">
            <input required value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              className={inputClass} placeholder="Support" />
          </FormField>
          <FormField label="Routing Strategy">
            <select value={form.strategy}
              onChange={(e) => setForm({ ...form, strategy: e.target.value })}
              className={inputClass}>
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value} className="dark:bg-panel-surface bg-white">{s.label}</option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-x-4">
            <FormField label="Max Wait Time (sec)">
              <input type="number" min="0" value={form.maxWaitTime}
                onChange={(e) => setForm({ ...form, maxWaitTime: Number(e.target.value) })}
                className={inputClass} />
            </FormField>
            <FormField label="Max Queue Size">
              <input type="number" min="0" value={form.maxQueueSize}
                onChange={(e) => setForm({ ...form, maxQueueSize: Number(e.target.value) })}
                className={inputClass} />
            </FormField>
          </div>
          <FormField label="Action after Max No Answer" hint="Agent status set by FreeSWITCH when they miss max-no-answer calls (queue-level, mod_callcenter agent-no-answer-status).">
            <select value={form.agentNoAnswerStatus}
              onChange={(e) => setForm({ ...form, agentNoAnswerStatus: e.target.value })}
              className={inputClass}>
              {NO_ANSWER_STATUSES.map((s) => (
                <option key={s} value={s} className="dark:bg-panel-surface bg-white">{s}</option>
              ))}
            </select>
          </FormField>
        </form>
      </Modal>}

      {/* Tier (agent assignment) modal — admin only */}
      {isAdmin && (
        <Modal
          open={Boolean(tierQueue)}
          onClose={() => setTierQueue(null)}
          title={tierQueue ? `Agents in ${tierQueue.display_name}` : ''}
        >
          {tierQueue && (
            <div className="space-y-4">
              {tierError && (
                <p className="text-xs text-lamp-alert border border-lamp-alert/25 bg-lamp-alert/10 rounded-lg px-3 py-2">{tierError}</p>
              )}
              <div className="flex gap-2">
                <select value={tierAgentToAdd}
                  onChange={(e) => setTierAgentToAdd(e.target.value)}
                  className={inputClass}>
                  <option value="">Select an agent to add…</option>
                  {availableToAdd.map((a) => (
                    <option key={a.agent_id} value={a.agent_id} className="dark:bg-panel-surface bg-white">
                      {a.full_name} ({a.agent_id})
                    </option>
                  ))}
                </select>
                <button className={buttonPrimary} onClick={handleAddTier} disabled={!tierAgentToAdd}>
                  Add
                </button>
              </div>

              <div className="space-y-2">
                {tierQueue.agents.length === 0 && (
                  <p className="text-sm dark:text-ink-dim text-gray-500">No agents assigned to this queue yet.</p>
                )}
                {tierQueue.agents.map((a) => (
                  <div key={a.agent_id}
                    className="flex items-center justify-between rounded-lg border dark:border-panel-border border-gray-200 px-3 py-2">
                    <div className="flex items-center gap-3">
                      <StatusLamp status={a.status} showLabel={false} />
                      <div>
                        <p className="text-sm font-medium dark:text-ink text-gray-800">{a.full_name}</p>
                        <p className="text-[11px] dark:text-ink-faint text-gray-400 font-mono">{a.agent_id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] uppercase tracking-wide dark:text-ink-faint text-gray-400">Lvl</label>
                      <input type="number" min="1" max="10" defaultValue={a.level}
                        onBlur={(e) => { const v = Number(e.target.value); if (v !== a.level) handleSetTier(a.agent_id, { level: v }); }}
                        className={`${inputClass} w-14 py-1`} title="Tier level (lower tried first)" />
                      <label className="text-[10px] uppercase tracking-wide dark:text-ink-faint text-gray-400">Pos</label>
                      <input type="number" min="1" max="100" defaultValue={a.position}
                        onBlur={(e) => { const v = Number(e.target.value); if (v !== a.position) handleSetTier(a.agent_id, { position: v }); }}
                        className={`${inputClass} w-14 py-1`} title="Tie-break position within a level" />
                      <select defaultValue=""
                        onChange={(e) => { if (e.target.value) { handleSetTier(a.agent_id, { state: e.target.value }); e.target.value = ''; } }}
                        className={`${inputClass} w-28 py-1`} title="Set tier state (FreeSWITCH runtime)">
                        <option value="">Set state…</option>
                        {TIER_STATES.map((s) => (
                          <option key={s} value={s} className="dark:bg-panel-surface bg-white">{s}</option>
                        ))}
                      </select>
                      <button onClick={() => handleRemoveTier(a.agent_id)}
                        className="p-1 rounded-lg dark:text-ink-faint text-gray-400 hover:text-lamp-alert hover:bg-lamp-alert/10 transition-colors"
                        title="Remove from queue">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
