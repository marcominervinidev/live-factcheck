# Detection eval report: dry-mock

- Run: 2026-09-30T08:08:16.594Z
- Dataset: `evals/detection.de.jsonl`, 161 segments **including labels not yet reviewed by the owner (not a valid result, brief 13.5)**
- Providers: [{"service":"claim-extractor","role":"classifier","provider":"mock","cloud":false},{"service":"claim-extractor","role":"llm","provider":"mock","model":"mock","cloud":false}]

## Result

| Metric | Value |
|---|---|
| Precision | 76.9 % |
| Recall | 42.6 % |
| F1 | 54.8 % |
| True / false positives | 20 / 6 |
| False / true negatives | 27 / 108 |
| Timeouts (not counted above) | 0 |
| Latency p50 / p95 (publish → handled) | 55 ms / 59 ms |

## Errors

- False positives: bt20-213-r16-01, bt20-213-r16-15, bt20-213-r16-23, bt20-213-r10-08, bt20-213-r10-25, bt20-213-r18-25
- False negatives: bt20-213-r05-06, bt20-213-r05-10, bt20-213-r05-11, bt20-213-r05-12, bt20-213-r05-15, bt20-213-r05-16, bt20-213-r05-21, bt20-213-r08-02, bt20-213-r08-09, bt20-213-r08-16, bt20-213-r08-20, bt20-213-r08-30, bt20-213-r16-02, bt20-213-r16-08, bt20-213-r16-16, bt20-213-r16-17, bt20-213-r16-26, bt20-213-r10-03, bt20-213-r10-05, bt20-213-r10-26, bt20-213-r11-05, bt20-213-r11-09, bt20-213-r11-15, bt20-213-r11-18, bt20-213-r11-22, bt20-213-r18-07, bt20-213-r18-23
- Timeouts: –
