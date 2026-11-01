-- =====================================================================
-- Manufacturing defect traceability schema (SQLite 3)
-- Master data -> transactions -> events; every state change is an
-- explicit event row, derived columns are recomputed by the validator.
-- All PKs are natural deterministic IDs, all relationships have FKs.
-- =====================================================================
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- product
CREATE TABLE IF NOT EXISTS product (
    product_id         TEXT PRIMARY KEY,                 -- SKU-000001
    name               TEXT NOT NULL,
    family             TEXT NOT NULL,
    product_type       TEXT NOT NULL
                       CHECK (product_type IN ('finished_good','subassembly','component','raw_material')),
    uom                TEXT NOT NULL CHECK (uom IN ('EA','KG')),
    revision           TEXT NOT NULL CHECK (revision GLOB 'R[0-9][0-9]'),
    lifecycle_state    TEXT NOT NULL CHECK (lifecycle_state IN ('active','phase_out','obsolete')),
    rework_allowed     INTEGER NOT NULL CHECK (rework_allowed IN (0,1)),
    scrap_tolerance_pct REAL NOT NULL CHECK (scrap_tolerance_pct >= 0 AND scrap_tolerance_pct <= 10),
    effective_from     TEXT NOT NULL,
    effective_to       TEXT,
    created_at         TEXT NOT NULL,
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- --------------------------------------------------------------- supplier
CREATE TABLE IF NOT EXISTS supplier (
    supplier_id        TEXT PRIMARY KEY,                 -- SUP-0001
    name               TEXT NOT NULL,
    supplier_type      TEXT NOT NULL
                       CHECK (supplier_type IN ('raw_material','component','packaging','service')),
    country            TEXT NOT NULL,
    risk_tier          TEXT NOT NULL CHECK (risk_tier IN ('A','B','C')),
    qualification_state TEXT NOT NULL CHECK (qualification_state IN ('approved','conditional','blocked')),
    approved_on        TEXT NOT NULL,
    lead_time_days     INTEGER NOT NULL CHECK (lead_time_days BETWEEN 1 AND 120),
    effective_from     TEXT NOT NULL,
    effective_to       TEXT,
    quality_contact_role TEXT NOT NULL,
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- ------------------------------------------- supplier_material (N:M bridge)
CREATE TABLE IF NOT EXISTS supplier_material (
    supplier_material_id TEXT PRIMARY KEY,               -- SM-000001
    supplier_id        TEXT NOT NULL REFERENCES supplier(supplier_id),
    product_id         TEXT NOT NULL REFERENCES product(product_id),
    qualification_state TEXT NOT NULL CHECK (qualification_state IN ('approved','conditional','blocked')),
    unit_price_usd     REAL NOT NULL CHECK (unit_price_usd > 0),
    effective_from     TEXT NOT NULL,
    effective_to       TEXT,
    UNIQUE (supplier_id, product_id, effective_from)
);

-- ------------------------------------------------ bom_line (N:M bridge)
CREATE TABLE IF NOT EXISTS bom_line (
    bom_id             TEXT PRIMARY KEY,                 -- BOM-000001
    product_id         TEXT NOT NULL REFERENCES product(product_id),
    component_product_id TEXT NOT NULL REFERENCES product(product_id),
    qty_per_unit       REAL NOT NULL CHECK (qty_per_unit > 0),
    uom                TEXT NOT NULL CHECK (uom IN ('EA','KG')),
    scrap_pct          REAL NOT NULL CHECK (scrap_pct >= 0 AND scrap_pct <= 5),
    alternate_group    TEXT,
    effective_from     TEXT NOT NULL,
    effective_to       TEXT,
    CHECK (product_id <> component_product_id),
    CHECK (effective_to IS NULL OR effective_to > effective_from),
    UNIQUE (product_id, component_product_id, effective_from)
);

-- ---------------------------------------------------------------- machine
CREATE TABLE IF NOT EXISTS machine (
    machine_id         TEXT PRIMARY KEY,                 -- MAC-001
    name               TEXT NOT NULL,
    plant              TEXT NOT NULL,
    line               TEXT NOT NULL,
    machine_type       TEXT NOT NULL
                       CHECK (machine_type IN ('cnc','press','weld','assembly','oven','leak_test','packaging','test')),
    commissioned_on    TEXT NOT NULL,
    last_maintenance_on TEXT NOT NULL,
    status             TEXT NOT NULL CHECK (status IN ('running','idle','maintenance','down')),
    design_uph         REAL NOT NULL CHECK (design_uph > 0),
    CHECK (last_maintenance_on >= commissioned_on)
);

-- ------------------------------------------------------ inspection_plan
CREATE TABLE IF NOT EXISTS inspection_plan (
    plan_id            TEXT PRIMARY KEY,                 -- IP-0001
    product_id         TEXT NOT NULL REFERENCES product(product_id),
    inspection_type    TEXT NOT NULL CHECK (inspection_type IN ('incoming','in_process','final')),
    sample_size        INTEGER NOT NULL CHECK (sample_size BETWEEN 1 AND 500),
    aql_level          REAL NOT NULL CHECK (aql_level IN (0.65,1.0,1.5,2.5)),
    acceptance_qty     INTEGER NOT NULL CHECK (acceptance_qty >= 0),
    rejection_qty      INTEGER NOT NULL CHECK (rejection_qty > acceptance_qty),
    criteria           TEXT NOT NULL,
    effective_from     TEXT NOT NULL,
    effective_to       TEXT,
    CHECK (effective_to IS NULL OR effective_to > effective_from),
    UNIQUE (product_id, inspection_type, effective_from)
);

-- ---------------------------------------------------------- material_lot
CREATE TABLE IF NOT EXISTS material_lot (
    lot_id             TEXT PRIMARY KEY,                 -- LOT-SUP-0001-2026-000001
    supplier_id        TEXT NOT NULL REFERENCES supplier(supplier_id),
    material_product_id TEXT NOT NULL REFERENCES product(product_id),
    supplier_material_id TEXT NOT NULL REFERENCES supplier_material(supplier_material_id),
    received_date      TEXT NOT NULL,
    received_qty       REAL NOT NULL CHECK (received_qty > 0),
    uom                TEXT NOT NULL CHECK (uom IN ('EA','KG')),
    expiry_date        TEXT NOT NULL,
    coa_pass           INTEGER NOT NULL CHECK (coa_pass IN (0,1)),
    certificate_ref    TEXT NOT NULL,
    -- derived columns, recomputed and asserted by validate.py
    status             TEXT NOT NULL
                       CHECK (status IN ('quarantine','released','partially_consumed','consumed','rejected','expired')),
    consumed_qty       REAL NOT NULL DEFAULT 0 CHECK (consumed_qty >= 0),
    remaining_qty      REAL NOT NULL DEFAULT 0 CHECK (remaining_qty >= 0),
    created_at         TEXT NOT NULL,
    CHECK (expiry_date > received_date)
    -- consumed_qty + remaining_qty = received_qty is reconciled by validate.py
    -- with a float tolerance instead of a table CHECK.
);

-- ------------------------------------------------------ production_order
CREATE TABLE IF NOT EXISTS production_order (
    order_id           TEXT PRIMARY KEY,                 -- WO-2026-000001
    product_id         TEXT NOT NULL REFERENCES product(product_id),
    plant              TEXT NOT NULL,
    line               TEXT NOT NULL,
    planned_qty        INTEGER NOT NULL CHECK (planned_qty > 0),
    actual_qty         INTEGER,
    -- derived columns, recomputed and asserted by validate.py
    scrap_qty          INTEGER NOT NULL DEFAULT 0 CHECK (scrap_qty >= 0),
    good_qty           INTEGER NOT NULL DEFAULT 0 CHECK (good_qty >= 0),
    planned_start      TEXT NOT NULL,
    planned_end        TEXT NOT NULL,
    actual_start       TEXT,
    actual_end         TEXT,
    status             TEXT NOT NULL
                       CHECK (status IN ('planned','released','in_progress','completed','closed','cancelled')),
    priority           TEXT NOT NULL CHECK (priority IN ('standard','expedite','hold')),
    rework_of_order_id TEXT REFERENCES production_order(order_id),
    planner_code       TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    CHECK (planned_end > planned_start),
    CHECK (rework_of_order_id IS NULL OR rework_of_order_id <> order_id),
    CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end > actual_start)
);

-- ----------------------------------------------------------- process_step
CREATE TABLE IF NOT EXISTS process_step (
    step_id            TEXT PRIMARY KEY,                 -- PS-2026-000001-01
    order_id           TEXT NOT NULL REFERENCES production_order(order_id),
    sequence_no        INTEGER NOT NULL CHECK (sequence_no BETWEEN 1 AND 12),
    step_name          TEXT NOT NULL,
    machine_id         TEXT NOT NULL REFERENCES machine(machine_id),
    planned_duration_min REAL NOT NULL CHECK (planned_duration_min > 0),
    actual_duration_min  REAL NOT NULL CHECK (actual_duration_min > 0),
    started_at         TEXT NOT NULL,
    ended_at           TEXT NOT NULL,
    operator_code      TEXT NOT NULL,
    temperature_c      REAL NOT NULL,
    pressure_bar       REAL NOT NULL,
    speed_uph          REAL NOT NULL CHECK (speed_uph > 0),
    input_qty          INTEGER NOT NULL CHECK (input_qty >= 0),
    output_qty         INTEGER NOT NULL CHECK (output_qty >= 0),
    scrap_qty          INTEGER NOT NULL CHECK (scrap_qty >= 0),
    status             TEXT NOT NULL CHECK (status IN ('pending','started','completed')),
    UNIQUE (order_id, sequence_no),
    CHECK (ended_at > started_at),
    CHECK (input_qty = output_qty + scrap_qty)
);

-- ------------------------------- order_consumption (N:M order <-> lot)
CREATE TABLE IF NOT EXISTS order_consumption (
    consumption_id     TEXT PRIMARY KEY,                 -- CONS-2026-000001
    order_id           TEXT NOT NULL REFERENCES production_order(order_id),
    lot_id             TEXT NOT NULL REFERENCES material_lot(lot_id),
    bom_id             TEXT NOT NULL REFERENCES bom_line(bom_id),
    step_id            TEXT NOT NULL REFERENCES process_step(step_id),
    qty_consumed       REAL NOT NULL CHECK (qty_consumed > 0),
    uom                TEXT NOT NULL CHECK (uom IN ('EA','KG')),
    consumed_at        TEXT NOT NULL
);

-- --------------------------------------------------------- state events
CREATE TABLE IF NOT EXISTS order_event (
    event_id           TEXT PRIMARY KEY,                 -- EVT-ORD-000001
    order_id           TEXT NOT NULL REFERENCES production_order(order_id),
    event_type         TEXT NOT NULL,
    from_state         TEXT,
    to_state           TEXT NOT NULL,
    occurred_at        TEXT NOT NULL,
    actor_code         TEXT NOT NULL,
    note               TEXT
);

CREATE TABLE IF NOT EXISTS lot_event (
    event_id           TEXT PRIMARY KEY,                 -- EVT-LOT-000001
    lot_id             TEXT NOT NULL REFERENCES material_lot(lot_id),
    event_type         TEXT NOT NULL,
    from_state         TEXT,
    to_state           TEXT NOT NULL,
    occurred_at        TEXT NOT NULL,
    actor_code         TEXT NOT NULL,
    note               TEXT
);

CREATE TABLE IF NOT EXISTS capa_event (
    event_id           TEXT PRIMARY KEY,                 -- EVT-CAPA-000001
    capa_id            TEXT NOT NULL REFERENCES capa(capa_id),
    event_type         TEXT NOT NULL,
    from_state         TEXT,
    to_state           TEXT NOT NULL,
    occurred_at        TEXT NOT NULL,
    actor_code         TEXT NOT NULL,
    note               TEXT
);

-- ------------------------------------------------------ inspection_result
CREATE TABLE IF NOT EXISTS inspection_result (
    inspection_id      TEXT PRIMARY KEY,                 -- INSP-2026-000001-001
    plan_id            TEXT NOT NULL REFERENCES inspection_plan(plan_id),
    inspection_type    TEXT NOT NULL CHECK (inspection_type IN ('incoming','in_process','final')),
    order_id           TEXT REFERENCES production_order(order_id),
    lot_id             TEXT REFERENCES material_lot(lot_id),
    step_id            TEXT REFERENCES process_step(step_id),
    machine_id         TEXT REFERENCES machine(machine_id),
    inspected_qty      INTEGER NOT NULL CHECK (inspected_qty > 0),
    sampled_qty        INTEGER NOT NULL CHECK (sampled_qty > 0 AND sampled_qty <= inspected_qty),
    measured_value     REAL,
    spec_min           REAL,
    spec_max           REAL,
    acceptance_qty     INTEGER NOT NULL CHECK (acceptance_qty >= 0),
    rejection_qty      INTEGER NOT NULL CHECK (rejection_qty > acceptance_qty),
    -- derived: defect_count = SUM(defect.qty); defect_rate = defect_count / inspected_qty
    defect_count       INTEGER NOT NULL DEFAULT 0 CHECK (defect_count >= 0),
    defect_rate        REAL NOT NULL DEFAULT 0 CHECK (defect_rate >= 0 AND defect_rate <= 1),
    result             TEXT NOT NULL CHECK (result IN ('pass','conditional','fail','pending')),
    inspected_at       TEXT NOT NULL,
    inspector_code     TEXT NOT NULL,
    CHECK (order_id IS NOT NULL OR lot_id IS NOT NULL),
    CHECK (defect_count <= inspected_qty),
    CHECK (spec_min IS NULL OR spec_max IS NULL OR spec_max > spec_min),
    CHECK (measured_value IS NULL OR spec_min IS NULL OR measured_value >= 0)
);

-- ----------------------------------------------------------------- defect
CREATE TABLE IF NOT EXISTS defect (
    defect_id          TEXT PRIMARY KEY,                 -- DEF-2026-000001
    inspection_id      TEXT NOT NULL REFERENCES inspection_result(inspection_id),
    order_id           TEXT REFERENCES production_order(order_id),
    lot_id             TEXT REFERENCES material_lot(lot_id),
    step_id            TEXT REFERENCES process_step(step_id),
    machine_id         TEXT REFERENCES machine(machine_id),
    defect_code        TEXT NOT NULL,
    defect_name        TEXT NOT NULL,
    category           TEXT NOT NULL
                       CHECK (category IN ('dimensional','material','assembly','functional','cosmetic','documentation')),
    severity           TEXT NOT NULL CHECK (severity IN ('minor','major','critical')),
    qty                INTEGER NOT NULL CHECK (qty > 0),
    supplier_responsibility INTEGER NOT NULL CHECK (supplier_responsibility IN (0,1)),
    detection_method   TEXT NOT NULL CHECK (detection_method IN ('visual','gauge','functional_test','certificate_review')),
    detected_at        TEXT NOT NULL,
    status             TEXT NOT NULL CHECK (status IN ('open','contained','rework','scrap','closed'))
);

-- ------------------------------------------------------------------- capa
CREATE TABLE IF NOT EXISTS capa (
    capa_id            TEXT PRIMARY KEY,                 -- CAPA-2026-000001
    defect_id          TEXT NOT NULL UNIQUE REFERENCES defect(defect_id),
    root_cause_category TEXT NOT NULL
                       CHECK (root_cause_category IN ('supplier_material','process_parameter','machine_calibration','operator_error','design','handling','documentation')),
    containment_action TEXT NOT NULL,
    containment_completed_at TEXT,
    corrective_action  TEXT NOT NULL,
    preventive_action  TEXT NOT NULL,
    owner_role         TEXT NOT NULL,
    opened_at          TEXT NOT NULL,
    due_at             TEXT NOT NULL,
    verification_inspection_id TEXT REFERENCES inspection_result(inspection_id),
    verified_at        TEXT,
    closed_at          TEXT,
    status             TEXT NOT NULL
                       CHECK (status IN ('open','in_progress','pending_verification','verified','closed','cancelled')),
    effectiveness_score REAL CHECK (effectiveness_score IS NULL OR (effectiveness_score >= 0 AND effectiveness_score <= 1)),
    CHECK (due_at > opened_at)
    -- NOTE: closure-gate is a *business rule* (v_capa_gate + trace.py), not a
    -- table constraint: a bypassed gate must remain visible in history.
);

-- --------------------------------------- labelled anomaly / issue register
CREATE TABLE IF NOT EXISTS anomaly_register (
    anomaly_id         TEXT PRIMARY KEY,                 -- ANOM-0001
    issue_type         TEXT NOT NULL,
    source_file        TEXT NOT NULL,
    table_name         TEXT NOT NULL,
    record_id          TEXT NOT NULL,
    field_name         TEXT NOT NULL,
    expected_label     TEXT NOT NULL,
    detection_rule     TEXT NOT NULL,
    severity           TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    injected_value     TEXT,
    note               TEXT
);

-- ------------------------------------------------------------------ indexes
CREATE INDEX IF NOT EXISTS ix_bom_product        ON bom_line(product_id);
CREATE INDEX IF NOT EXISTS ix_bom_component      ON bom_line(component_product_id);
CREATE INDEX IF NOT EXISTS ix_sm_supplier        ON supplier_material(supplier_id);
CREATE INDEX IF NOT EXISTS ix_lot_supplier       ON material_lot(supplier_id);
CREATE INDEX IF NOT EXISTS ix_lot_material       ON material_lot(material_product_id);
CREATE INDEX IF NOT EXISTS ix_plan_product       ON inspection_plan(product_id, inspection_type);
CREATE INDEX IF NOT EXISTS ix_order_product      ON production_order(product_id);
CREATE INDEX IF NOT EXISTS ix_order_status       ON production_order(status);
CREATE INDEX IF NOT EXISTS ix_step_order         ON process_step(order_id);
CREATE INDEX IF NOT EXISTS ix_step_machine       ON process_step(machine_id, started_at);
CREATE INDEX IF NOT EXISTS ix_cons_order         ON order_consumption(order_id);
CREATE INDEX IF NOT EXISTS ix_cons_lot           ON order_consumption(lot_id);
CREATE INDEX IF NOT EXISTS ix_insp_order         ON inspection_result(order_id);
CREATE INDEX IF NOT EXISTS ix_insp_lot           ON inspection_result(lot_id);
CREATE INDEX IF NOT EXISTS ix_insp_step          ON inspection_result(step_id);
CREATE INDEX IF NOT EXISTS ix_insp_time          ON inspection_result(inspected_at);
CREATE INDEX IF NOT EXISTS ix_defect_insp        ON defect(inspection_id);
CREATE INDEX IF NOT EXISTS ix_defect_order       ON defect(order_id);
CREATE INDEX IF NOT EXISTS ix_defect_lot         ON defect(lot_id);
CREATE INDEX IF NOT EXISTS ix_capa_status        ON capa(status);

-- ------------------------------------------------------------------- views
-- Single wide view used by the trace engine and analytics: every row is a
-- validated join path from an inspection back to order, step, machine, lot.
CREATE VIEW IF NOT EXISTS v_inspection_context AS
SELECT i.inspection_id, i.inspection_type, i.inspected_at, i.inspected_qty,
       i.defect_count, i.defect_rate, i.result,
       i.order_id, o.product_id AS order_product_id, o.plant, o.line,
       o.status AS order_status,
       i.step_id, s.sequence_no, s.step_name,
       s.machine_id, m.machine_type, m.plant AS machine_plant,
       i.lot_id, l.supplier_id, l.material_product_id,
       i.plan_id
FROM inspection_result i
LEFT JOIN production_order o ON o.order_id = i.order_id
LEFT JOIN process_step s     ON s.step_id  = i.step_id
LEFT JOIN machine m          ON m.machine_id = s.machine_id
LEFT JOIN material_lot l     ON l.lot_id   = i.lot_id;

CREATE VIEW IF NOT EXISTS v_lot_balance AS
SELECT l.lot_id, l.received_qty, l.consumed_qty, l.remaining_qty, l.status,
       COALESCE(c.qty, 0) AS recomputed_consumed_qty,
       COALESCE(c.n, 0)   AS consumption_count
FROM material_lot l
LEFT JOIN (SELECT lot_id, SUM(qty_consumed) AS qty, COUNT(*) AS n
           FROM order_consumption GROUP BY lot_id) c ON c.lot_id = l.lot_id;

CREATE VIEW IF NOT EXISTS v_capa_gate AS
SELECT c.capa_id, c.defect_id, c.status, c.opened_at, c.due_at,
       c.containment_completed_at, c.verification_inspection_id,
       c.verified_at, c.closed_at,
       CASE
         WHEN c.status <> 'closed' THEN 1
         WHEN c.verified_at IS NULL OR c.verification_inspection_id IS NULL THEN 0
         WHEN c.closed_at < c.verified_at THEN 0
         WHEN c.verified_at < c.opened_at THEN 0
         WHEN i.result <> 'pass' THEN 0
         WHEN c.containment_completed_at IS NOT NULL AND i.inspected_at < c.containment_completed_at THEN 0
         ELSE 1
       END AS closure_allowed,
       CASE
         WHEN c.status <> 'closed' THEN NULL
         WHEN c.verified_at IS NULL OR c.verification_inspection_id IS NULL THEN 'NO_VERIFICATION'
         WHEN c.closed_at < c.verified_at THEN 'CLOSED_BEFORE_VERIFICATION'
         WHEN c.verified_at < c.opened_at THEN 'VERIFIED_BEFORE_OPEN'
         WHEN i.result <> 'pass' THEN 'VERIFICATION_NOT_PASSED'
         WHEN c.containment_completed_at IS NOT NULL AND i.inspected_at < c.containment_completed_at THEN 'VERIFIED_BEFORE_CONTAINMENT'
         ELSE NULL
       END AS gate_reason
FROM capa c
LEFT JOIN inspection_result i ON i.inspection_id = c.verification_inspection_id;
