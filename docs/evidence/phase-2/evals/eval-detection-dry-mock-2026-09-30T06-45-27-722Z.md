# Detection eval report: dry-mock

- Run: 2026-09-30T06:45:27.722Z
- Dataset: `evals/detection.de.jsonl`, 154 segments **including labels not yet reviewed by the owner (not a valid result, brief 13.5)**
- Providers: [{"service":"claim-extractor","role":"classifier","provider":"mock","cloud":false},{"service":"claim-extractor","role":"llm","provider":"mock","model":"mock","cloud":false}]

## Result

| Metric | Value |
|---|---|
| Precision | 72.0 % |
| Recall | 51.4 % |
| F1 | 60.0 % |
| True / false positives | 18 / 7 |
| False / true negatives | 17 / 112 |
| Timeouts (not counted above) | 0 |
| Latency p50 / p95 (publish → handled) | 54 ms / 58 ms |

## Errors

- False positives: bt20-213-r16-03, bt20-213-r16-06, bt20-213-r16-14, bt20-213-r16-20, bt20-213-r10-06, bt20-213-r10-23, bt20-213-r18-25
- False negatives: bt20-213-r05-11, bt20-213-r05-12, bt20-213-r05-16, bt20-213-r05-21, bt20-213-r08-02, bt20-213-r08-10, bt20-213-r08-14, bt20-213-r08-18, bt20-213-r16-07, bt20-213-r16-15, bt20-213-r10-05, bt20-213-r10-24, bt20-213-r18-07, bt20-213-r18-23, bt20-213-r11-09, bt20-213-r11-18, bt20-213-r11-22
- Timeouts: –
