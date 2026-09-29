# Streaming STT providers for phase 2 (research, 2026-09-29)

Sources: Deepgram docs and JS SDK README via Context7 (`/websites/developers_deepgram`, `/deepgram/deepgram-js-sdk`), AssemblyAI docs via Context7 (`/websites/assemblyai`), provider pricing and data-residency pages (links below). Prices and credits are the providers' own figures, checked 2026-09-29; re-check before any budget decision. Implementation loads this file instead of re-reading the docs.

## Deepgram (default candidate)

- **Endpoint:** `wss://api.deepgram.com/v1/listen`, EU: `wss://api.eu.deepgram.com/v1/listen` (GA since 2026-01-10, same keys, same features except hosted Whisper; processing stays in the EU). **We use the EU endpoint.**
- **Auth (server side):** `Authorization: Token <key>` header on the handshake. The key never reaches the browser.
- **Query parameters we need:** `model=nova-3`, `language=de` (Nova-3 German monolingual, improved for streaming in 2026-07), `encoding=linear16`, `sample_rate=16000`, `channels=1`, `interim_results=true`, `punctuate=true`, `smart_format=true`, `diarize=true` (speaker per word; phase 3 uses it, phase 2 already forwards the label), `endpointing=300` (ms of silence before `speech_final`; 300–500 recommended for conversations), `utterance_end_ms=1000` (needs `interim_results`), `vad_events=true`, `mip_opt_out=true` (opt out of the Model Improvement Program; no price change for pay-as-you-go since 2026-03-05).
- **Client messages:** binary audio frames; `{"type":"KeepAlive"}` during silence (the connection closes after ~10 s without audio); `{"type":"Finalize"}` flushes pending audio; `{"type":"CloseStream"}` ends the stream gracefully.
- **Server messages:** `Results` with `channel.alternatives[0].transcript`, `words[]` (`start`, `end`, `speaker`, `confidence`), `is_final` (this chunk will not change), `speech_final` (end of an utterance after `endpointing`), `start`/`duration` in seconds; plus `Metadata`, `SpeechStarted`, `UtteranceEnd`.
- **Mapping to `TranscriptSegment`:** interim = `is_final: false`; a final segment = the concatenated `is_final` results up to `speech_final` or `UtteranceEnd`. Speaker = majority `speaker` of the words, mapped to `A`, `B`, … Times in ms relative to the start of the recording.
- **SDK:** `@deepgram/sdk` v5: `await client.listen.v1.connect({...})`, register handlers, `connection.connect()`, `await connection.waitForOpen()` (audio sent before open is lost), `sendMedia(buffer)`, `sendFinalize(...)`, `close()`. Accepts an `abortSignal`. The SDK can point at the EU host via a custom base URL (check in T2.2; otherwise use `ws` directly with the documented protocol).
- **Price:** Nova-3 monolingual streaming $0.0077/min list, currently $0.0048/min promotional; billed per second. **New accounts: $200 credit, no card, no expiry** – ample for development (~40,000 min).
- **Data:** EU endpoint keeps processing in the EU; opt out of model improvement per request (`mip_opt_out`).

## AssemblyAI (second adapter, mock-tested only)

- **Endpoint:** `wss://streaming.assemblyai.com/v3/ws`, EU: `wss://streaming.eu.assemblyai.com/v3/ws` (AWS eu-west-1, same price).
- **Auth (server side):** `Authorization: <key>` header; browsers would use a temporary token (not needed, our key stays server side).
- **Parameters:** `sample_rate=16000`, `encoding=pcm_s16le`, `speech_model=universal-streaming-multilingual` (English, Spanish, French, **German**, Italian, Portuguese) or `universal-3-5-pro` (18 languages, code-switching, streaming diarization for up to 10 speakers), `format_turns=true`.
- **Audio:** PCM16 LE mono, chunks of 50–1000 ms (our 100 ms frames fit).
- **Client messages:** binary audio; `{"type":"Terminate"}` (graceful end), `{"type":"ForceEndpoint"}`, `{"type":"KeepAlive"}`, `{"type":"UpdateConfiguration", …}`.
- **Server messages:** `Begin`, `Turn` (`transcript`, `words[]` with `start`/`end` in ms and `word_is_final`, `end_of_turn`, `turn_is_formatted`, `end_of_turn_confidence`), `Termination`. With `format_turns` a turn arrives twice at its end (unformatted, then formatted): **treat a turn as final only when `end_of_turn && turn_is_formatted`.**
- **Mapping:** interim = `Turn` without `end_of_turn`; final = formatted end-of-turn. Speaker label only with the pro model's diarization, otherwise `A`.
- **Price:** Universal-Streaming $0.15/h; Universal-3.5 Pro realtime $0.45/h + $0.12/h diarization. Free tier: 333 h streaming.
- **SDK:** `assemblyai` (Node) has a streaming transcriber; decide in T2.2 whether it supports the EU host and v3 cleanly, else `ws` directly.

## Comparison for this project

| | Deepgram Nova-3 | AssemblyAI Universal-Streaming |
|---|---|---|
| German streaming | yes (monolingual model) | yes (multilingual model) |
| Interim results | yes | yes (turn updates) |
| Diarization while streaming | yes (`diarize`) | only with the pro model (extra charge) |
| EU processing | yes | yes |
| Price per hour | ~$0.29–0.46 | $0.15 (without diarization) |
| Free start | $200 credit | 333 h streaming |

Proposal for ADR 0016: **Deepgram as default** (German model, diarization included, fine-grained interim results for a live transcript), AssemblyAI as the tested second adapter. Final decision after the real Deepgram test in T2.5 (latency to `speech_final`, German quality on our WAV fixture).

## Budget

Both bill per audio time. The price table in `packages/providers/src/pricing.ts` gets per-minute STT prices; `transcription` books recorded minutes against `CLOUD_DAILY_BUDGET_USD` in the same Redis counter as the LLM calls (`budget.ts`).

## Links

- https://developers.deepgram.com/docs/understand-endpointing-interim-results
- https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program
- https://deepgram.com/learn/deepgram-eu-endpoint-now-generally-available
- https://deepgram.com/pricing
- https://www.assemblyai.com/docs/streaming/universal-streaming
- https://www.assemblyai.com/docs/streaming/message-sequence
- https://www.assemblyai.com/docs/streaming/endpoints-and-data-zones
- https://www.assemblyai.com/pricing
