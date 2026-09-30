// `pnpm eval:detection` (brief 13.5, ADR 0017): replays the detection set as final transcript
// segments into `transcript.segments` of a running stack and measures what the claim-extractor
// makes of them (pre-filter, window, classifier, deduplication). Unlike the claim eval it cannot
// go through the gateway, which accepts only audio for live mode, so it runs inside the internal
// network with the services' Redis user (compose.test.yaml, service `eval-detection`).
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EventEnvelope, STREAMS, sessionEventsChannel } from '@lfc/contracts';
import type { TranscriptSegment } from '@lfc/contracts';
import { processedMarker, publishEvent } from '@lfc/service-kit';
import { Redis } from 'ioredis';

import type { DetectionItem } from './dataset.js';
import { loadDetection } from './dataset.js';
import type { DetectionOutcome } from './detection.js';
import { detectionReport, summarizeDetection } from './detection.js';

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
};

const LABEL = env('EVAL_LABEL')
  .replace(/[^a-z0-9-]/gi, '-')
  .toLowerCase();
const DATASET = env('EVAL_DATASET', new URL('../detection.de.jsonl', import.meta.url).pathname);
const OUT_DIR = env(
  'EVAL_OUT_DIR',
  new URL('../../docs/evidence/phase-2/evals', import.meta.url).pathname,
);
const INCLUDE_UNREVIEWED = process.env['EVAL_INCLUDE_UNREVIEWED'] === 'true';
const TIMEOUT_MS = Number(env('EVAL_TIMEOUT_MS', '60000'));
const LIMIT = Number(env('EVAL_LIMIT', '0'));
/** Spacing of the replayed segments on the transcript timeline. */
const SEGMENT_SPACING_MS = 5_000;

const redisUrl = new URL(env('REDIS_URL'));
const options = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || '6379'),
  username: env('REDIS_USERNAME'),
  // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- read from the secret file
  password: readFileSync(env('REDIS_PASSWORD_FILE'), 'utf8').trim(),
  maxRetriesPerRequest: 1,
};
const redis = new Redis(options);
const subscriber = new Redis(options);
const marker = processedMarker(redis, 'claim-extractor', 60);

/** Segment ids that ended as a claim, from the session channel like the gateway sees them. */
const detectedSegments = new Set<string>();
subscriber.on('message', (_channel: string, raw: string) => {
  const parsed = EventEnvelope.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) return;
  const event = parsed.data;
  if (event.type === 'claim.detected')
    for (const id of event.payload.sourceSegmentIds) detectedSegments.add(id);
});

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Polls `check` every 50 ms until it is true (true) or the deadline passed (false). */
async function waitUntil(check: () => Promise<boolean>, deadline: number): Promise<boolean> {
  if (await check()) return true;
  if (performance.now() > deadline) return false;
  await sleep(50);
  return waitUntil(check, deadline);
}

async function replay(item: DetectionItem, sessionId: string, index: number) {
  const segment: TranscriptSegment = {
    schemaVersion: 1,
    sessionId,
    segmentId: randomUUID(),
    speaker: item.speaker,
    text: item.text,
    startMs: index * SEGMENT_SPACING_MS,
    endMs: index * SEGMENT_SPACING_MS + SEGMENT_SPACING_MS - 500,
    isFinal: true,
    language: 'de',
  };
  const started = performance.now();
  await publishEvent(redis, STREAMS.transcriptSegments, {
    type: 'transcript.segment',
    schemaVersion: 2,
    payload: segment,
  });
  // The extractor marks a segment after it published its claim (or dropped it).
  const processed = await waitUntil(
    () => marker.isProcessed(segment.segmentId),
    started + TIMEOUT_MS,
  );
  if (!processed) return { item, processed: false, detected: false };
  const latencyMs = performance.now() - started;
  // The claim travels over Pub/Sub on another connection; give it a moment to arrive.
  await sleep(200);
  return { item, processed: true, detected: detectedSegments.has(segment.segmentId), latencyMs };
}

const all = loadDetection(DATASET);
const items = all
  .filter((item) => INCLUDE_UNREVIEWED || item.reviewed)
  .slice(0, LIMIT > 0 ? LIMIT : undefined);
if (items.length === 0) {
  console.error(
    `No items to evaluate: ${String(all.length)} in the set, none reviewed. Review labels or set EVAL_INCLUDE_UNREVIEWED=true for a dry run.`,
  );
  process.exit(1);
}

const providers = (await redis.get('status:v1:claim-extractor')) ?? 'unknown';
const startedAt = new Date().toISOString();
const outcomes: DetectionOutcome[] = [];
const conversations = new Map<string, DetectionItem[]>();
for (const item of items)
  conversations.set(item.conversationId, [...(conversations.get(item.conversationId) ?? []), item]);

/** One session per conversation: its segments in order, so the window matches a live recording. */
async function replayConversation(segments: readonly DetectionItem[]): Promise<void> {
  const sessionId = randomUUID();
  const channel = sessionEventsChannel(sessionId);
  await subscriber.subscribe(channel);
  for (const [index, item] of segments.entries()) {
    // Sequential on purpose: the classifier sees the previous segments as context, like live.
    const outcome = await replay(item, sessionId, index); // NOSONAR typescript:S9382
    outcomes.push(outcome);
    const got = outcome.processed ? String(outcome.detected) : 'timeout';
    console.log(
      `${String(outcomes.length).padStart(3)}/${String(items.length)} ${item.id}: expected ${String(item.expected)}, got ${got}`,
    );
  }
  await subscriber.unsubscribe(channel);
}

// Conversations one after another as well: latencies stay comparable and rate limits hold.
for (const segments of conversations.values()) await replayConversation(segments); // NOSONAR typescript:S9382
subscriber.disconnect();
redis.disconnect();

const summary = summarizeDetection(outcomes);
const base = `eval-detection-${LABEL}-${startedAt.replace(/[:.]/g, '-')}`;
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  join(OUT_DIR, `${base}.md`),
  detectionReport(
    {
      label: LABEL,
      startedAt,
      dataset: DATASET.split('/').slice(-2).join('/'),
      includesUnreviewed: INCLUDE_UNREVIEWED,
      providers,
    },
    summary,
  ),
);
// Raw results for later analysis; the segments are public protocol text, no secrets.
writeFileSync(
  join(OUT_DIR, `${base}.json`),
  JSON.stringify(
    outcomes.map((o) => ({
      id: o.item.id,
      expected: o.item.expected,
      processed: o.processed,
      detected: o.detected,
      latencyMs: o.latencyMs,
    })),
    null,
    2,
  ),
);
const reportPath = join(OUT_DIR, `${base}.md`);
console.log(`\nReport: ${reportPath}`);
console.log(
  `precision ${summary.precision.toFixed(3)}, recall ${summary.recall.toFixed(3)}, f1 ${summary.f1.toFixed(3)}, timeouts ${String(summary.timeouts)}`,
);
