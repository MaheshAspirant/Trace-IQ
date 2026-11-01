const state = {
  meta: null, overview: null, exceptions: [], suppliers: [], machines: [], capas: [],
  validation: null, evaluation: null, loaded: {},
};

const fmt = (n) => (n === null || n === undefined || n === '') ? '–' : Number(n).toLocaleString('en-US');
const pct = (x, d = 2) => (x === null || x === undefined) ? '–' : (Number(x) * 100).toFixed(d) + '%';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = (text, cls = 'neutral') => `<span class="badge ${cls}">${esc(text)}</span>`;
const sevCls = (s) => `sev-${s || 'low'}`;

async function api(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({ error: response.statusText }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function table(columns, rows, emptyText = 'No rows') {
  if (!rows || !rows.length) return `<div class="empty">${esc(emptyText)}</div>`;
  const head = columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map((row) => `<tr>${columns.map((c) => {
    const raw = c.render ? c.render(row) : row[c.key];
    const value = raw === null || raw === undefined || raw === '' ? '–' : raw;
    return `<td class="${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''}">${c.html ? value : esc(value)}</td>`;
  }).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function kpi(label, value, sub = '', cls = '') {
  return `<div class="kpi ${cls}"><div class="label">${esc(label)}</div>
    <div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
}

/* ------------------------------------------------------------------ routing */
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
  lazyLoad(name);
}

function lazyLoad(name) {
  const loaders = {
    exceptions: loadExceptions, suppliers: loadSuppliers, capa: loadCapas, evaluation: loadEvaluation,
  };
  if (loaders[name] && !state.loaded[name]) {
    state.loaded[name] = true;
    loaders[name]().catch((err) => { state.loaded[name] = false; console.error(err); });
  }
}

/* ----------------------------------------------------------------- overview */
async function loadMeta() {
  const meta = await api('/api/meta');
  state.meta = meta;
  const counts = meta.row_counts || {};
  document.getElementById('meta').textContent =
    `${meta.profile} profile · seed ${meta.seed} · ${fmt(counts.product)} SKUs · ` +
    `${fmt(counts.production_order)} orders · ${fmt(counts.inspection_result)} inspections · ` +
    `reference date ${meta.reference_date}`;
}

async function loadOverview() {
  const o = await api('/api/overview');
  state.overview = o;
  const q = o.quality, c = o.capa, t = o.traceability;
  document.getElementById('kpis').innerHTML = [
    kpi('Defect rate', pct(q.defect_rate), `${fmt(q.dppm)} DPPM · ${fmt(q.defect_qty)} defect units / ${fmt(q.inspected_qty)} inspected`),
    kpi('First pass yield', pct(q.first_pass_yield), `${fmt(q.failed_inspections)} failed inspections`),
    kpi('Scrap rate', pct(q.scrap_rate), `${fmt(q.scrap_qty)} of ${fmt(q.produced_qty)} units`, q.scrap_rate > 0.03 ? 'warn' : 'good'),
    kpi('CAPA closure', pct(c.closure_rate), `${fmt(c.closed)} closed / ${fmt(c.total)} total`, c.overdue ? 'warn' : ''),
    kpi('Overdue CAPA', fmt(c.overdue), `${fmt(c.closure_gate_violations)} gate violations`, c.overdue ? 'bad' : 'good'),
    kpi('Trace completeness', pct(t.trace_completeness), `${fmt(t.with_order)} of ${fmt(t.defects)} defects linked to an order`),
  ].join('');
  const exceptions = await api('/api/exceptions?limit=8');
  state.exceptions = exceptions;
  document.getElementById('overview-exceptions').innerHTML = table([
    { key: 'severity', label: 'severity', render: (r) => badge(r.severity, sevCls(r.severity)), html: true },
    { key: 'type', label: 'issue' },
    { key: 'ref', label: 'record' },
    { key: 'detail', label: 'detail', wrap: true },
  ], exceptions.slice(0, 8));
  const suppliers = await api('/api/suppliers');
  state.suppliers = suppliers;
  const ranked = suppliers.filter((s) => s.incoming_inspected_qty)
    .sort((a, b) => b.incoming_defect_rate - a.incoming_defect_rate).slice(0, 8);
  document.getElementById('overview-suppliers').innerHTML = table([
    { key: 'supplier_id', label: 'supplier' },
    { key: 'incoming_defect_rate', label: 'rate', num: true, render: (r) => pct(r.incoming_defect_rate) },
    { key: 'lots_rejected', label: 'rejected lots', num: true },
    { key: 'decision', label: 'decision', render: (r) => badge(r.decision, r.decision === 'MONITOR' ? 'good' : 'warn'), html: true },
  ], ranked);
  const machines = await api('/api/machines');
  state.machines = machines;
  const worst = machines.filter((m) => m.input_qty).sort((a, b) => b.scrap_rate - a.scrap_rate).slice(0, 8);
  document.getElementById('overview-machines').innerHTML = table([
    { key: 'machine_id', label: 'machine' },
    { key: 'machine_type', label: 'type' },
    { key: 'scrap_rate', label: 'scrap rate', num: true, render: (r) => pct(r.scrap_rate) },
    { key: 'defect_rate', label: 'defect rate', num: true, render: (r) => pct(r.defect_rate) },
    { key: 'drift_weeks', label: 'drift weeks', num: true },
    { key: 'decision', label: 'decision', render: (r) => badge(r.decision, r.decision === 'NORMAL' ? 'good' : 'warn'), html: true },
  ], worst);
}

/* --------------------------------------------------------------- exceptions */
function renderExceptions() {
  const kind = document.getElementById('exception-kind').value;
  const severity = document.getElementById('exception-severity').value;
  const rows = state.exceptions.filter((e) => (!kind || e.kind === kind) && (!severity || e.severity === severity));
  document.getElementById('exception-count').textContent = `${rows.length} of ${state.exceptions.length} exceptions`;
  document.getElementById('exception-table').innerHTML = table([
    { key: 'severity', label: 'severity', render: (r) => badge(r.severity, sevCls(r.severity)), html: true },
    { key: 'kind', label: 'kind' },
    { key: 'type', label: 'issue type' },
    { key: 'ref', label: 'record' },
    { key: 'label', label: 'label' },
    { key: 'rule', label: 'rule' },
    { key: 'detail', label: 'detail', wrap: true },
    { key: 'action', label: 'recommended action', wrap: true },
  ], rows.slice(0, 250));
}

async function loadExceptions() {
  state.exceptions = await api('/api/exceptions?limit=500');
  renderExceptions();
}

/* ------------------------------------------------------------------- trace */
function renderTrace(data) {
  if (data.error) {
    document.getElementById('trace-result').innerHTML = `<div class="card"><div class="error">${esc(data.error)}</div></div>`;
    return;
  }
  const d = data.defect, decision = data.decision, order = data.order;
  const consensus = {
    RETURN_TO_SUPPLIER: 'bad', SCRAP: 'bad', REWORK: 'warn',
    QUARANTINE_REVIEW: 'warn', USE_AS_IS: 'good',
  }[decision.disposition] || 'neutral';
  const chips = Object.entries(decision.inputs).map(([k, v]) =>
    `<span class="chip">${esc(k)}=${esc(v)}</span>`).join('');
  const chain = data.chain.map((step) => `
    <div class="chain-step">
      <div class="chain-stage">${esc(step.stage)}</div>
      <div class="chain-body">
        <div class="chain-record">${esc(step.record)}</div>
        <div class="chain-detail">${esc(step.detail)}</div>
      </div>
    </div>`).join('');
  const consumptions = table([
    { key: 'lot_id', label: 'material lot' },
    { key: 'component_name', label: 'component' },
    { key: 'supplier_name', label: 'supplier' },
    { key: 'qty_consumed', label: 'qty', num: true },
    { key: 'consumed_at', label: 'issued at' },
    { key: 'lot_status', label: 'lot status' },
  ], data.consumptions);
  const exposureRows = data.exposure.orders_sharing_lot.map((o) =>
    ({ ...o, kind: 'shares lot' })).concat(
    data.exposure.orders_same_machine_window.map((o) => ({ ...o, kind: 'same machine ±3d' })));
  const exposureTable = table([
    { key: 'order_id', label: 'order' },
    { key: 'product_name', label: 'product' },
    { key: 'status', label: 'status' },
    { key: 'kind', label: 'why exposed' },
  ], exposureRows, 'No additional exposure found');
  const capa = data.capa;
  const capaSection = capa ? `
    <h3>Corrective action</h3>
    <div class="table-wrap">${table([
      { key: 'capa_id', label: 'capa' },
      { key: 'status', label: 'status', render: (r) => badge(r.status, r.status === 'closed' ? 'good' : 'warn'), html: true },
      { key: 'owner_role', label: 'owner' },
      { key: 'due_at', label: 'due' },
      { key: 'verified_at', label: 'verified' },
      { key: 'closure_allowed', label: 'gate', render: (r) => r.closure_allowed ? badge('closure allowed', 'good') : badge(`blocked: ${r.gate_reason || 'n/a'}`, 'bad'), html: true },
    ], [capa])}</div>` : `<h3>Corrective action</h3><div class="empty">No CAPA required by the rules for this defect.</div>`;

  document.getElementById('trace-result').innerHTML = `
    <div class="card">
      <div class="trace-head">
        <div>
          <div class="trace-title">${esc(d.defect_id)} · ${esc(d.defect_name)}</div>
          <div class="hint">${esc(d.defect_code)} · ${esc(d.category)} · qty ${esc(d.qty)} · detected ${esc(d.detected_at)} · inspection ${esc(d.inspection_id)}</div>
        </div>
        <div>${badge(d.severity, sevCls(d.severity))} ${badge(d.status, 'neutral')}</div>
      </div>
      <div class="decision">
        <span class="pill">${esc(decision.disposition)}</span>
        ${badge(decision.disposition_rule, 'neutral')}
        ${decision.capa_required ? badge('CAPA required: ' + decision.capa_rule, 'warn') : badge('no CAPA required', 'good')}
        <ul>${decision.rationale.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="chips">${chips}</div>
      </div>
      <div class="grid-2">
        <div>
          <h3>Traceability chain</h3>
          <div class="chain">${chain}</div>
        </div>
        <div>
          <h3>Containment</h3>
          <div class="hint">${esc(data.containment.note)}</div>
          <ul class="actions">${data.containment.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
          <div class="chips">
            <span class="chip">qty at risk: ${esc(data.containment.qty_at_risk)}</span>
            <span class="chip">open orders: ${data.containment.open_orders.length}</span>
            <span class="chip">chain complete: ${data.chain_complete ? 'yes' : 'no'}</span>
          </div>
          <h3>Exposure</h3>
          <div class="table-wrap">${exposureTable}</div>
        </div>
      </div>
      <h3>Material issued to the order</h3>
      <div class="table-wrap">${consumptions}</div>
      ${capaSection}
      <h3>Downstream</h3>
      <div class="table-wrap">${table([
        { key: 'order_id', label: 'later order (same product)' },
        { key: 'status', label: 'status' },
        { key: 'actual_start', label: 'started' },
        { key: 'planned_qty', label: 'qty', num: true },
      ], data.downstream.orders_same_product, 'No later orders for this product')}</div>
    </div>`;
}

async function trace(defectId) {
  const box = document.getElementById('trace-result');
  box.innerHTML = `<div class="card"><div class="empty">Tracing ${esc(defectId)}…</div></div>`;
  try {
    const data = await api(`/api/trace?defect_id=${encodeURIComponent(defectId)}`);
    renderTrace(data);
  } catch (err) {
    box.innerHTML = `<div class="card"><div class="error">${esc(err.message)}</div></div>`;
  }
}

/* -------------------------------------------------------- suppliers/machines */
async function loadSuppliers() {
  state.suppliers = await api('/api/suppliers');
  document.getElementById('supplier-table').innerHTML = table([
    { key: 'supplier_id', label: 'supplier' },
    { key: 'name', label: 'name' },
    { key: 'risk_tier', label: 'risk' },
    { key: 'qualification_state', label: 'qualification' },
    { key: 'lots_received', label: 'lots', num: true },
    { key: 'lots_rejected', label: 'rejected', num: true },
    { key: 'incoming_defect_rate', label: 'incoming rate', num: true, render: (r) => pct(r.incoming_defect_rate) },
    { key: 'portfolio_median_rate', label: 'median', num: true, render: (r) => pct(r.portfolio_median_rate) },
    { key: 'critical_events', label: 'critical', num: true },
    { key: 'decision', label: 'decision', render: (r) => badge(r.decision, r.decision === 'MONITOR' ? 'good' : 'warn'), html: true },
    { key: 'decision_reason', label: 'reason', wrap: true },
  ], state.suppliers);
  state.machines = await api('/api/machines');
  document.getElementById('machine-table').innerHTML = table([
    { key: 'machine_id', label: 'machine' },
    { key: 'name', label: 'name' },
    { key: 'machine_type', label: 'type' },
    { key: 'status', label: 'status' },
    { key: 'input_qty', label: 'input', num: true },
    { key: 'scrap_rate', label: 'scrap rate', num: true, render: (r) => pct(r.scrap_rate) },
    { key: 'defect_rate', label: 'defect rate', num: true, render: (r) => pct(r.defect_rate) },
    { key: 'drift_weeks', label: 'drift weeks', num: true },
    { key: 'decision', label: 'decision', render: (r) => badge(r.decision, r.decision === 'NORMAL' ? 'good' : 'warn'), html: true },
  ], state.machines);
}

/* -------------------------------------------------------------------- CAPA */
async function loadCapas() {
  state.capas = await api('/api/capas?limit=200');
  document.getElementById('capa-table').innerHTML = table([
    { key: 'capa_id', label: 'capa' },
    { key: 'status', label: 'status', render: (r) => badge(r.status, r.status === 'closed' ? 'good' : (r.days_overdue ? 'bad' : 'warn')), html: true },
    { key: 'severity', label: 'severity', render: (r) => badge(r.severity, sevCls(r.severity)), html: true },
    { key: 'product_name', label: 'product' },
    { key: 'supplier_name', label: 'supplier' },
    { key: 'root_cause_category', label: 'root cause' },
    { key: 'due_at', label: 'due' },
    { key: 'days_overdue', label: 'days late', num: true },
    { key: 'verified_at', label: 'verified' },
    { key: 'closure_allowed', label: 'gate', render: (r) => r.closure_allowed ? badge('ok', 'good') : badge(`blocked: ${r.gate_reason || 'n/a'}`, 'bad'), html: true },
    { key: 'owner_role', label: 'owner' },
  ], state.capas);
}

/* -------------------------------------------------------------- evaluation */
async function loadEvaluation() {
  const [validation, evaluation] = await Promise.all([api('/api/validation'), api('/api/evaluation')]);
  state.validation = validation;
  state.evaluation = evaluation;
  const summary = validation.summary || {};
  document.getElementById('validation-summary').innerHTML = [
    kpi('Checks passed', `${fmt(summary.passed)} / ${fmt(summary.total)}`, 'validation suite', summary.failed ? 'bad' : 'good'),
    kpi('Decision agreement', pct(evaluation.decisions?.disposition_agreement), `${fmt(evaluation.decisions?.evaluated)} defects re-decided`),
    kpi('CAPA trigger agreement', pct(evaluation.decisions?.capa_agreement), 'rule-derived labels'),
    kpi('Closure gate agreement', pct(evaluation.capa_gate?.agreement), `${fmt(evaluation.capa_gate?.evaluated)} CAPAs`),
    kpi('Drift precision / recall',
      `${pct(evaluation.drift_detection?.precision, 0)} / ${pct(evaluation.drift_detection?.recall, 0)}`,
      `${fmt(evaluation.drift_detection?.true_positive)} true positives`),
    kpi('Supplier rate error', Number(evaluation.supplier_rate_measurement?.mean_absolute_error || 0).toFixed(4),
      `MAE vs latent rate · r=${evaluation.supplier_rate_measurement?.pearson_r}`),
  ].join('');
  document.getElementById('validation-checks').innerHTML = table([
    { key: 'id', label: 'id' },
    { key: 'category', label: 'category' },
    { key: 'name', label: 'check', wrap: true },
    { key: 'status', label: 'status', render: (r) => badge(r.status, r.status === 'PASS' ? 'good' : 'bad'), html: true },
    { key: 'expected', label: 'expected', wrap: true },
    { key: 'detail', label: 'observed', wrap: true },
  ], validation.checks || []);
  const coverage = evaluation.anomaly_detection || {};
  const rows = Object.entries(coverage).map(([type, stat]) => ({ type, ...stat }));
  document.getElementById('coverage-table').innerHTML = table([
    { key: 'type', label: 'issue type' },
    { key: 'labelled', label: 'labelled', num: true },
    { key: 'detected', label: 'detected', num: true },
    { key: 'matched', label: 'matched', num: true },
  ], rows);
}

/* -------------------------------------------------------------------- boot */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (tab) showTab(tab.dataset.tab);
  });
  document.getElementById('trace-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = document.getElementById('defect-input').value.trim().toUpperCase();
    if (value) trace(value);
  });
  document.getElementById('sample-defect').addEventListener('click', async () => {
    try {
      const sample = await api('/api/sample-defect');
      document.getElementById('defect-input').value = sample.defect_id;
      trace(sample.defect_id);
    } catch (err) {
      document.getElementById('trace-result').innerHTML = `<div class="card"><div class="error">${esc(err.message)}</div></div>`;
    }
  });
  document.getElementById('exception-kind').addEventListener('change', renderExceptions);
  document.getElementById('exception-severity').addEventListener('change', renderExceptions);
  loadMeta().catch((err) => console.error(err));
  loadOverview().catch((err) => {
    document.getElementById('kpis').innerHTML = `<div class="error">${esc(err.message)}</div>`;
  });
});
