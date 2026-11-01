# Evaluation report

Profile `full` · seed `20261022`

## Decision agreement (engine re-derived from persisted rows)

- Disposition agreement: **100.00%** over 4678 labelled defects
- CAPA trigger agreement: **99.47%**
- CAPA closure-gate agreement: **100.00%** over 901 CAPAs

| disposition rule | evaluated | agreement |
|---|---:|---:|
| R2_BLOCKED_SUPPLIER | 83 | 100.00% |
| R3_CRITICAL_DEFECT | 673 | 100.00% |
| R4_RATE_LIMIT | 372 | 100.00% |
| R5_REPEAT_SUPPLIER | 205 | 100.00% |
| R6_MAJOR_DEFECT | 2073 | 100.00% |
| R7_MINOR_DEFECT | 1272 | 100.00% |

## Process-drift detection (machine-week granularity)

- Precision **0.44**, recall **0.65**, F1 **0.52**
- flagged 25 machine-weeks, labelled 17; TP 11, FP 14, FN 6

## Anomaly detection

| issue_type | labelled | detected | matched |
|---|---:|---:|---:|
| BOM_MATERIAL_NOT_CONSUMED | 12 | 12 | 12 |
| CAPA_CLOSED_BEFORE_VERIFICATION | 6 | 6 | 6 |
| DEFECT_COUNT_EXCEEDS_INSPECTED_QTY | 6 | 6 | 6 |
| DEFECT_LOT_NOT_FOUND | 8 | 8 | 8 |
| DUPLICATE_CONSUMPTION | 5 | 5 | 5 |
| EXPIRED_LOT_CONSUMED | 7 | 7 | 7 |
| TRACE_CHAIN_BREAK | 9 | 9 | 9 |

## Supplier defect-rate measurement

- Observed vs latent incoming defect rate over 50 suppliers: MAE **0.0236**, Pearson r **0.91**
