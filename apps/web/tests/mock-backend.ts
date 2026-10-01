import type { Page, WebSocketRoute } from '@playwright/test';

export const TEST_TOKEN = 'test-token-for-the-mocked-backend-000';
const SESSION_ID = '6f1c1e9a-3b1f-4c55-9a53-2f4a9c1d7e10';

type Verdict = 'stimmt' | 'groesstenteils_richtig' | 'uebertrieben' | 'falsch' | 'nicht_pruefbar';

interface Scenario {
  readonly verdict: Verdict;
  readonly level: 'hoch' | 'mittel' | 'niedrig';
  readonly reason?: string;
  readonly factCheck?: boolean;
  readonly explanation?: string;
}

/** Verdicts the mocked backend gives, keyed by a word in the claim. */
const SCENARIOS: readonly [RegExp, Scenario][] = [
  [
    /20 Jahre/,
    {
      verdict: 'falsch',
      level: 'hoch',
      factCheck: true,
      explanation: 'Der Zweite Weltkrieg endete 1945, also vor über 80 Jahren.',
    },
  ],
  [
    /Einwohner/,
    {
      verdict: 'groesstenteils_richtig',
      level: 'mittel',
      explanation: 'Berlin hatte Ende 2024 rund 3,9 Millionen Einwohner.',
    },
  ],
  [/finde/, { verdict: 'nicht_pruefbar', level: 'hoch', reason: 'classified_unverifiable' }],
  [/endete 1965/, { verdict: 'falsch', level: 'hoch' }],
];

const probabilities = (verdict: Verdict, top: number) =>
  Object.fromEntries(
    (['stimmt', 'groesstenteils_richtig', 'uebertrieben', 'falsch', 'nicht_pruefbar'] as const).map(
      (v) => [v, v === verdict ? top : (1 - top) / 4],
    ),
  );

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

/**
 * The backend at the system boundary of the frontend (brief 13.2 stage 2b): the WebSocket via
 * page.routeWebSocket, REST via page.route. Events follow the real contracts.
 */
export class MockBackend {
  private socket: WebSocketRoute | undefined;
  /** Sessions the mock accepted; a reconnect adds one. */
  sessions = 0;
  /** Explanations are sent only when true; tests switch it off to see the timeout text. */
  sendExplanations = true;
  /** When true, claim.checked waits until releaseVerdicts() - a talk's last verdict can
   * then land after the stop, like a slow fact check. */
  holdVerdicts = false;
  private heldVerdicts: (() => void)[] = [];
  /** Control messages of live mode the client sent (`audio.start`, `audio.stop`). */
  readonly audioControls: string[] = [];
  /** Sizes of the binary audio frames received. */
  readonly frameSizes: number[] = [];
  private recordingId: string | undefined;
  private spoken = false;

  constructor(private readonly page: Page) {}

  async install(): Promise<void> {
    await this.page.routeWebSocket(/\/ws\/session$/, (ws) => {
      ws.onMessage((raw) => {
        if (typeof raw !== 'string') {
          this.onFrame(raw);
          return;
        }
        const message = JSON.parse(raw) as { type: string; token?: string };
        if (message.type === 'audio.start' || message.type === 'audio.stop') {
          this.onAudioControl(message.type);
          return;
        }
        if (message.type !== 'auth' || message.token !== TEST_TOKEN) {
          ws.send(
            JSON.stringify({
              type: 'error',
              schemaVersion: 2,
              code: 'unauthorized',
              message: 'Missing or invalid token',
            }),
          );
          void ws.close({ code: 4401 });
          return;
        }
        this.socket = ws;
        this.sessions++;
        ws.send(JSON.stringify({ type: 'session.ready', schemaVersion: 2, sessionId: SESSION_ID }));
      });
    });

    await this.page.route('**/api/claims/check', async (route) => {
      if (route.request().headers()['authorization'] !== `Bearer ${TEST_TOKEN}`) {
        await route.fulfill({
          status: 401,
          json: {
            schemaVersion: 1,
            error: { code: 'unauthorized', message: 'Missing or invalid token' },
          },
        });
        return;
      }
      const { text } = route.request().postDataJSON() as { text: string };
      const claimId = uuid();
      await route.fulfill({
        status: 202,
        json: { schemaVersion: 1, sessionId: SESSION_ID, claimId },
      });
      this.emit(claimId, text);
    });

    await this.page.route('**/api/status', (route) =>
      route.fulfill({
        json: {
          schemaVersion: 2,
          privacyMode: 'cloud',
          providers: [
            {
              service: 'fact-checker',
              role: 'classifier',
              provider: 'typesafe',
              model: 'jev-1.13.0',
              cloud: true,
            },
            { service: 'fact-checker', role: 'search', provider: 'searxng', cloud: false },
            {
              service: 'transcription',
              role: 'stt',
              provider: 'deepgram',
              model: 'nova-3',
              cloud: true,
            },
            {
              service: 'explainer',
              role: 'llm',
              provider: 'openai-compatible',
              model: 'qwen3-8b',
              cloud: false,
            },
          ],
        },
      }),
    );
  }

  /** Ends the running recording from the server side, e.g. with `budget_exceeded`. */
  endRecording(reason: 'budget_exceeded' | 'recording_limit' | 'provider_error'): void {
    const recordingId = this.recordingId;
    if (recordingId === undefined) return;
    this.recordingId = undefined;
    this.socket?.send(
      JSON.stringify({ type: 'audio.stopped', schemaVersion: 2, recordingId, reason }),
    );
  }

  private onAudioControl(type: 'audio.start' | 'audio.stop') {
    this.audioControls.push(type);
    if (type === 'audio.start') {
      this.recordingId = uuid();
      this.spoken = false;
      this.socket?.send(
        JSON.stringify({ type: 'audio.started', schemaVersion: 2, recordingId: this.recordingId }),
      );
    } else if (this.recordingId !== undefined) {
      this.endRecordingAsClient();
    }
  }

  private endRecordingAsClient() {
    const recordingId = this.recordingId;
    this.recordingId = undefined;
    this.socket?.send(
      JSON.stringify({ type: 'audio.stopped', schemaVersion: 2, recordingId, reason: 'client' }),
    );
  }

  /** After half a second of audio the "speaker" says a false claim, like the mock STT provider. */
  private onFrame(frame: Buffer) {
    this.frameSizes.push(frame.byteLength);
    if (this.spoken || this.frameSizes.length < 5) return;
    this.spoken = true;
    const segmentId = uuid();
    const segment = (text: string, isFinal: boolean) => ({
      type: 'transcript.segment',
      schemaVersion: 2,
      payload: {
        schemaVersion: 1,
        sessionId: SESSION_ID,
        segmentId,
        speaker: 'B',
        text,
        startMs: 0,
        endMs: 2_000,
        isFinal,
        language: 'de',
      },
    });
    this.send(segment('Der Zweite Weltkrieg', false));
    setTimeout(() => {
      const text = 'Der Zweite Weltkrieg endete 1965.';
      this.send(segment(text, true));
      this.emit(uuid(), text, [segmentId]);
    }, 300);
  }

  /** Closes the WebSocket from the server side (e.g. a gateway restart). */
  async dropConnection(): Promise<void> {
    await this.socket?.close({ code: 1012 });
  }

  private send(event: object) {
    this.socket?.send(JSON.stringify({ type: 'event', schemaVersion: 2, event }));
  }

  private emit(claimId: string, text: string, sourceSegmentIds: string[] = []) {
    const scenario = SCENARIOS.find(([pattern]) => pattern.test(text))?.[1] ?? {
      verdict: 'stimmt',
      level: 'hoch',
    };
    const now = new Date().toISOString();
    this.send({
      type: 'claim.detected',
      schemaVersion: 2,
      payload: {
        schemaVersion: 3,
        sessionId: SESSION_ID,
        claimId,
        speaker: 'A',
        originalText: text,
        standaloneText: text,
        normalizedText: text.toLowerCase(),
        checkworthiness: 1,
        sourceSegmentIds,
        detectedAt: now,
        detectMs: 0,
        provider: { classifier: 'text-mode', model: 'none' },
      },
    });
    const evidenceId = uuid();
    const uncheckable = scenario.verdict === 'nicht_pruefbar';
    const deliver = () => {
      this.send({
        type: 'claim.checked',
        schemaVersion: 2,
        payload: {
          schemaVersion: 2,
          sessionId: SESSION_ID,
          claimId,
          speaker: 'A',
          claim: text,
          verdict: scenario.verdict,
          probabilities: probabilities(scenario.verdict, scenario.level === 'hoch' ? 0.92 : 0.65),
          confidence: scenario.level === 'hoch' ? 0.9 : 0.56,
          confidenceLevel: scenario.level,
          evidence: uncheckable
            ? []
            : [
                {
                  evidenceId,
                  title: 'Zweiter Weltkrieg',
                  url: 'https://de.wikipedia.org/wiki/Zweiter_Weltkrieg',
                  publisher: 'Wikipedia',
                  retrievedAt: now,
                  tier: 'referenz',
                  snippet: 'Der Zweite Weltkrieg endete am 2. September 1945.',
                },
              ],
          ...(uncheckable ? { reason: scenario.reason } : { bestEvidenceId: evidenceId }),
          cacheHit: 'none',
          ...(scenario.factCheck === true
            ? {
                existingFactCheck: {
                  publisher: 'CORRECTIV',
                  url: 'https://correctiv.org/faktencheck/x',
                  rating: 'Falsch',
                },
              }
            : {}),
          timings: { detectMs: 0, retrieveMs: 100, classifyMs: 20, totalMs: 150 },
          checkedAt: now,
          provider: { classifier: 'mock', model: 'mock', search: 'mock', embeddings: 'mock' },
          usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        },
      });
      if (this.sendExplanations && scenario.explanation !== undefined) {
        setTimeout(() => {
          this.send({
            type: 'claim.explained',
            schemaVersion: 2,
            payload: {
              schemaVersion: 1,
              sessionId: SESSION_ID,
              claimId,
              explanation: scenario.explanation,
              provider: { llm: 'mock', model: 'mock' },
            },
          });
        }, 300);
      }
    };
    if (this.holdVerdicts) this.heldVerdicts.push(deliver);
    else setTimeout(deliver, 300);
  }

  /** Sends every held claim.checked (and its explanation) now. */
  releaseVerdicts(): void {
    const held = this.heldVerdicts;
    this.heldVerdicts = [];
    for (const deliver of held) deliver();
  }
}
