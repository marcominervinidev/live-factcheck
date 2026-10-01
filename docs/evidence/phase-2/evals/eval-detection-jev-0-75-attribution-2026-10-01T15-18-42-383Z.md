# Detection eval report: jev-0-75-attribution

- Run: 2026-10-01T15:18:42.383Z
- Dataset: `evals/detection.de.jsonl`, 161 segments (owner-reviewed labels only)
- Providers: [{"service":"claim-extractor","role":"classifier","provider":"typesafe","model":"jev-1.13.0","cloud":true},{"service":"claim-extractor","role":"llm","provider":"anthropic","model":"claude-haiku-4-5","cloud":true}]

## Result

| Metric | Value |
|---|---|
| Precision | 84.4 % |
| Recall | 57.4 % |
| F1 | 68.4 % |
| True / false positives | 27 / 5 |
| False / true negatives | 20 / 109 |
| Timeouts (not counted above) | 0 |
| Latency p50 / p95 (publish → handled) | 312 ms / 1898 ms |

## Errors

- False positives: bt20-213-r08-05, bt20-213-r08-13, bt20-213-r16-23, bt20-213-r10-10, bt20-213-r11-04
- False negatives: bt20-213-r05-04, bt20-213-r05-06, bt20-213-r05-07, bt20-213-r05-10, bt20-213-r05-11, bt20-213-r05-12, bt20-213-r08-08, bt20-213-r08-20, bt20-213-r08-30, bt20-213-r16-04, bt20-213-r16-06, bt20-213-r16-07, bt20-213-r16-08, bt20-213-r16-11, bt20-213-r16-26, bt20-213-r11-05, bt20-213-r11-09, bt20-213-r11-15, bt20-213-r11-21, bt20-213-r18-23
- Timeouts: –
