# Detection eval report: jev-0-60-attribution

- Run: 2026-10-01T15:21:05.034Z
- Dataset: `evals/detection.de.jsonl`, 161 segments (owner-reviewed labels only)
- Providers: [{"service":"claim-extractor","role":"classifier","provider":"typesafe","model":"jev-1.13.0","cloud":true},{"service":"claim-extractor","role":"llm","provider":"anthropic","model":"claude-haiku-4-5","cloud":true}]

## Result

| Metric | Value |
|---|---|
| Precision | 77.1 % |
| Recall | 78.7 % |
| F1 | 77.9 % |
| True / false positives | 37 / 11 |
| False / true negatives | 10 / 103 |
| Timeouts (not counted above) | 0 |
| Latency p50 / p95 (publish → handled) | 316 ms / 2013 ms |

## Errors

- False positives: bt20-213-r05-14, bt20-213-r08-05, bt20-213-r08-13, bt20-213-r16-21, bt20-213-r16-22, bt20-213-r16-23, bt20-213-r10-10, bt20-213-r11-04, bt20-213-r11-10, bt20-213-r18-08, bt20-213-r18-21
- False negatives: bt20-213-r05-04, bt20-213-r05-06, bt20-213-r05-11, bt20-213-r08-08, bt20-213-r08-30, bt20-213-r16-02, bt20-213-r16-04, bt20-213-r16-06, bt20-213-r11-09, bt20-213-r18-23
- Timeouts: –
