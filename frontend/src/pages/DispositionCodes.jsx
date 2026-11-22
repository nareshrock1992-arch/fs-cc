import { useState, useEffect, useCallback, useMemo } from 'react';
import { ClipboardCheck, Plus, Pencil, Power, Loader2, AlertTriangle, Lock } from 'lucide-react';
import { DispositionCodes } from '../api/client.js';
import Modal from '../components/Modal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { FormField, inputClass, buttonPrimary, buttonSecondary, buttonDanger } from '../components/form.jsx';

// Call outcomes (dispositions) agents choose in wrap-up. One global catalog; each
// queue offers either all active outcomes (default) or only the ones chosen for it.

const EMPTY_FORM = { code: '', name: '', description: '', display_order: 0, active: true };

const badge = {
  active:   'inline-flex px-2 py-0.5 rounded-full text-[0.6875rem] font-bold bg-lamp-available/10 text-lamp-available border border-lamp-available/20',
  inactive: 'inline-flex px-2 py-0.5 rounded-full text-[0.6875rem] font-bold bg-surface-2 dark:bg-panel-raised text-ink-faint border border-border dark:border-panel-border',
};
const iconBtn = 'p-1.5 rounded-lg text-ink-faint hover:bg-surface-2 dark:hover:bg-panel-raised';
const rowCls  = 'border-b border-border dark:border-panel-border/40 hover:bg-surface-2 dark:hover:bg-panel-raised/50';
const headCls = 'text-left text-[0.6875rem] text-ink-faint border-b border-border dark:border-panel-border';

function errText(e, fallback) { return e?.response?.data?.error || e?.message || fallback; }

export default function DispositionCodesPage() {
  const [codes, setCodes]     = useState([]);
  const [queues, setQueues]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [notice, setNotice]   = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [formErr, setFormErr]   = useState(null);
  const [saving, setSaving]     = useState(false);

  const [confirm, setConfirm]         = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [queueEdit, setQueueEdit]   = useState(null);   // { queue, mode: 'all'|'some', ids:Set }
  const [queueErr, setQueueErr]     = useState(null);
  const [queueBusy, setQueueBusy]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await DispositionCodes.list();
      setCodes(data.codes || []); setQueues(data.queues || []);
    } catch (e) { setError(errText(e, 'Failed to load outcomes')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const agentCodes = useMemo(() => codes.filter((c) => !c.is_system), [codes]);
  const systemCodes = useMemo(() => codes.filter((c) => c.is_system), [codes]);
  const codeById = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes]);

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setFormErr(null); setFormOpen(true); }
  function openEdit(row) {
    setEditing(row);
    setForm({ code: row.code, name: row.name, description: row.description || '',
              display_order: row.display_order ?? 0, active: !!row.active });
    setFormErr(null); setFormOpen(true);
  }

  async function submit(e) {
    e.preventDefault();
    if (!editing && !/^[A-Za-z0-9_]{2,64}$/.test(form.code.trim()))
      return setFormErr('Code must be 2–64 characters: letters, digits, underscore.');
    if (!form.name.trim()) return setFormErr('Name is required.');
    setSaving(true); setFormErr(null);
    const payload = { name: form.name.trim(), description: form.description.trim() || null,
                      display_order: Number(form.display_order) || 0, active: form.active };
    try {
      if (editing) { await DispositionCodes.update(editing.id, payload); setNotice(`Updated "${payload.name}".`); }
      else { await DispositionCodes.create({ ...payload, code: form.code.trim().toUpperCase() }); setNotice(`Created "${payload.name}".`); }
      setFormOpen(false);
      await load();
    } catch (e2) { setFormErr(errText(e2, 'Save failed')); }
    finally { setSaving(false); }
  }

  async function applyStatus() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await DispositionCodes.setStatus(confirm.id, !confirm.active);
      setNotice(`${confirm.active ? 'Deactivated' : 'Activated'} "${confirm.name}".`);
      setConfirm(null);
      await load();
    } catch (e) { setError(errText(e, 'Status change failed')); }
    finally { setConfirmBusy(false); }
  }

  function openQueue(q) {
    const ids = new Set((q.code_ids || []).map(Number));
    setQueueEdit({ queue: q, mode: ids.size ? 'some' : 'all', ids });
    setQueueErr(null);
  }
  function toggleQueueCode(id) {
    setQueueEdit((s) => {
      const ids = new Set(s.ids);
      if (ids.has(id)) ids.delete(id); else ids.add(id);
      return { ...s, ids };
    });
  }
  async function saveQueue() {
    const { queue, mode, ids } = queueEdit;
    if (mode === 'some' && ids.size === 0) return setQueueErr('Choose at least one outcome, or offer all outcomes.');
    setQueueBusy(true); setQueueErr(null);
    try {
      await DispositionCodes.setQueue(queue.id, mode === 'all' ? [] : [...ids]);
      setNotice(`Saved the outcomes for ${queue.display_name || queue.name}.`);
      setQueueEdit(null);
      await load();
    } catch (e) { setQueueErr(errText(e, 'Save failed')); }
    finally { setQueueBusy(false); }
  }

  function offeredLabel(q) {
    const ids = q.code_ids || [];
    if (!ids.length) return <span className="text-ink-dim dark:text-ink-faint">All active outcomes</span>;
    const names = ids.map((id) => codeById.get(Number(id))).filter(Boolean)
      .map((c) => (c.active ? c.name : `${c.name} (inactive)`));
    return <span className="text-ink">{names.join(', ')}</span>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p className="text-sm text-ink-dim">
          Outcomes agents choose when they wrap up a call. An outcome is required before an agent can use “Ready now”.
        </p>
        <button className={buttonPrimary} onClick={openCreate}><Plus size={15} /> Add Outcome</button>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-lamp-available/30 bg-lamp-available/10 px-3 py-2 text-sm text-lamp-available flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-lamp-available/70 hover:text-lamp-available text-xs">Dismiss</button>
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-lamp-alert/30 bg-lamp-alert/10 px-3 py-2 text-sm text-lamp-alert flex items-center justify-between">
          <span>{error}</span>
          <button onClick={load} className="text-lamp-alert/70 hover:text-lamp-alert text-xs">Retry</button>
        </div>
      )}

      {/* ── 1. Outcome catalog ─────────────────────────────────────────────── */}
      <div className="card overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-border dark:border-panel-border">
          <h2 className="text-sm font-semibold text-ink">Outcomes</h2>
        </div>
        {loading ? (
          <div className="p-5"><LoadingState rows={4} cols={4} label="Loading outcomes…" /></div>
        ) : agentCodes.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No outcomes yet"
            body="Add the outcomes agents choose after a call, for example Resolved or Callback needed."
            action={<button className={buttonPrimary} onClick={openCreate}><Plus size={15} /> Add Outcome</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr className={headCls}>
                  <th className="th">Outcome</th>
                  <th className="th">Code</th>
                  <th className="th">Status</th>
                  <th className="th">Order</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agentCodes.map((r) => (
                  <tr key={r.id} className={rowCls}>
                    <td className="td text-ink">
                      {r.name}
                      {r.description && <p className="text-xs text-ink-faint">{r.description}</p>}
                    </td>
                    <td className="td"><code className="text-xs text-ink dark:text-ink-dim">{r.code}</code></td>
                    <td className="td"><span className={r.active ? badge.active : badge.inactive}>{r.active ? 'Active' : 'Inactive'}</span></td>
                    <td className="td text-ink-dim dark:text-ink-faint tabular-nums">{r.display_order}</td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => openEdit(r)} title="Edit" aria-label={`Edit ${r.name}`}
                          className={`${iconBtn} hover:text-brand dark:hover:text-brand-light`}><Pencil size={15} /></button>
                        <button onClick={() => setConfirm(r)} title={r.active ? 'Deactivate' : 'Activate'}
                          aria-label={`${r.active ? 'Deactivate' : 'Activate'} ${r.name}`}
                          className={`${iconBtn} ${r.active ? 'hover:text-lamp-alert' : 'hover:text-lamp-available'}`}><Power size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && systemCodes.length > 0 && (
          <div className="px-4 py-3 border-t border-border dark:border-panel-border text-xs text-ink-faint flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1"><Lock size={12} aria-hidden="true" /> Set by the system:</span>
            {systemCodes.map((c) => <span key={c.id}>{c.name}</span>)}
          </div>
        )}
      </div>

      {/* ── 2. Outcomes per queue ──────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border dark:border-panel-border">
          <h2 className="text-sm font-semibold text-ink">Outcomes per queue</h2>
          <p className="text-xs text-ink-faint">A queue offers all active outcomes unless you choose specific ones.</p>
        </div>
        {loading ? (
          <div className="p-5"><LoadingState rows={3} cols={3} label="Loading queues…" /></div>
        ) : queues.length === 0 ? (
          <p className="px-4 py-5 text-sm text-ink-faint">No active queues.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr className={headCls}>
                  <th className="th">Queue</th>
                  <th className="th">Outcomes offered</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr key={q.id} className={rowCls}>
                    <td className="td text-ink whitespace-nowrap">{q.display_name || q.name}</td>
                    <td className="td">{offeredLabel(q)}</td>
                    <td className="td">
                      <div className="flex justify-end">
                        <button onClick={() => openQueue(q)} title="Choose outcomes" aria-label={`Choose outcomes for ${q.display_name || q.name}`}
                          className={`${iconBtn} hover:text-brand dark:hover:text-brand-light`}><Pencil size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / edit outcome */}
      <Modal open={formOpen} title={editing ? `Edit "${editing.name}"` : 'Add Outcome'}
        onClose={() => !saving && setFormOpen(false)}
        footer={<>
          <button className={buttonSecondary} onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
          <button className={buttonPrimary} onClick={submit} disabled={saving} form="outcome-form">
            {saving ? <Loader2 size={15} className="animate-spin" /> : null} Save
          </button>
        </>}>
        <form id="outcome-form" onSubmit={submit}>
          {formErr && <div className="mb-3 rounded-lg border border-lamp-alert/30 bg-lamp-alert/10 px-3 py-2 text-xs text-lamp-alert">{formErr}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <FormField label="Name agents see" required>
              <input className={inputClass} value={form.name} placeholder="Resolved"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </FormField>
            <FormField label="Code" required hint={editing ? 'Cannot be changed' : 'For reports, e.g. RESOLVED'}>
              <input className={inputClass} value={form.code} disabled={!!editing} placeholder="RESOLVED"
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </FormField>
          </div>
          <FormField label="Description" hint="Optional">
            <input className={inputClass} value={form.description} placeholder="Customer's issue was solved on the call"
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 items-end">
            <FormField label="Display order">
              <input type="number" min="0" className={inputClass} value={form.display_order}
                onChange={(e) => setForm((f) => ({ ...f, display_order: e.target.value }))} />
            </FormField>
            <label className="flex items-center gap-2 text-sm text-ink dark:text-ink-dim mb-4">
              <input type="checkbox" checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} /> Active
            </label>
          </div>
        </form>
      </Modal>

      {/* Activate / deactivate */}
      <Modal open={!!confirm} title={confirm?.active ? `Deactivate "${confirm?.name}"?` : `Activate "${confirm?.name}"?`}
        onClose={() => !confirmBusy && setConfirm(null)}
        footer={<>
          <button className={buttonSecondary} onClick={() => setConfirm(null)} disabled={confirmBusy}>Cancel</button>
          <button className={confirm?.active ? buttonDanger : buttonPrimary} onClick={applyStatus} disabled={confirmBusy}>
            {confirmBusy ? <Loader2 size={15} className="animate-spin" /> : null}{confirm?.active ? 'Deactivate' : 'Activate'}
          </button>
        </>}>
        {confirm?.active ? (
          <div className="flex items-start gap-3 text-sm text-ink-dim">
            <AlertTriangle size={18} className="text-lamp-alert shrink-0 mt-0.5" />
            <p>Agents will no longer see this outcome. Calls already saved with it keep it.</p>
          </div>
        ) : <p className="text-sm text-ink-dim">Agents will be able to choose this outcome again.</p>}
      </Modal>

      {/* Outcomes for one queue */}
      <Modal open={!!queueEdit} title={`Outcomes for ${queueEdit?.queue.display_name || queueEdit?.queue.name || ''}`}
        onClose={() => !queueBusy && setQueueEdit(null)}
        footer={<>
          <button className={buttonSecondary} onClick={() => setQueueEdit(null)} disabled={queueBusy}>Cancel</button>
          <button className={buttonPrimary} onClick={saveQueue} disabled={queueBusy}>
            {queueBusy ? <Loader2 size={15} className="animate-spin" /> : null} Save
          </button>
        </>}>
        {queueEdit && (
          <div className="space-y-3">
            {queueErr && <div className="rounded-lg border border-lamp-alert/30 bg-lamp-alert/10 px-3 py-2 text-xs text-lamp-alert">{queueErr}</div>}
            <fieldset className="space-y-2">
              <legend className="sr-only">Which outcomes this queue offers</legend>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="queue-mode" checked={queueEdit.mode === 'all'}
                  onChange={() => setQueueEdit((s) => ({ ...s, mode: 'all' }))} />
                All active outcomes
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="queue-mode" checked={queueEdit.mode === 'some'}
                  onChange={() => setQueueEdit((s) => ({ ...s, mode: 'some' }))} />
                Only these outcomes
              </label>
            </fieldset>
            {queueEdit.mode === 'some' && (
              <div className="ml-6 max-h-64 overflow-y-auto rounded-lg border border-border dark:border-panel-border divide-y divide-border dark:divide-panel-border">
                {agentCodes.length === 0 && <p className="px-3 py-2 text-sm text-ink-faint">Add outcomes first.</p>}
                {agentCodes.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm text-ink">
                    <input type="checkbox" checked={queueEdit.ids.has(c.id)} onChange={() => toggleQueueCode(c.id)} />
                    <span>{c.name}</span>
                    {!c.active && <span className={badge.inactive}>Inactive</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
