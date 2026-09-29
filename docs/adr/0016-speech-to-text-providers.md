# 0016: Speech-to-text providers

- Status: accepted (Marco, Gate 0, 2026-09-29: Deepgram as default, provider exchangeable by configuration; faster-whisper stays for `stt-local`, measured in T3 before any engine change). The real Deepgram test in T2.5 confirms the default.
- Date: 2026-09-29

## Context

Brief 10 asks for a streaming `SttProvider` with cloud adapters for Deepgram and AssemblyAI (compare streaming, German and diarization, pick a default), a local adapter that forwards to `stt-local` (faster-whisper, VAD-based pseudo-streaming, no diarization, `speaker: "A"`, startable natively on the Mac, `LOCAL_STT_URL`), and a mock adapter. The owner decided on 2026-09-29: a free Deepgram account for a real test; AssemblyAI only against mocks and documentation; `stt-local` in the container by default with an optional native start. Research: `.ai/research/stt-providers.md`, `.ai/research/faster-whisper.md`.

## Decision

- **Interface** (`packages/providers/src/stt/`): `SttProvider.open({ sessionId, recordingId, language, sampleRate }) → SttStream` with `write(frame)`, `end()` and an async iterator of `{ text, isFinal, startMs, endMs, speaker, confidence? }`. Adapters map provider output to `TranscriptSegment`; speakers become `A`, `B`, … in order of appearance.
- **Configuration** (per brief 8, per task): `STT_PROVIDER` = `mock` | `deepgram` | `assemblyai` | `local`, `STT_MODEL`, `STT_LANGUAGE` (default `de`), `STT_REGION` = `eu` (default) | `us`, secrets `DEEPGRAM_API_KEY_FILE` / `ASSEMBLYAI_API_KEY_FILE`, `LOCAL_STT_URL`. `PRIVACY_MODE=local` refuses `deepgram` and `assemblyai` at startup; `local` counts as local only if `LOCAL_STT_URL` is a local endpoint (`isLocalEndpoint`).
- **Default: Deepgram Nova-3 German over the EU endpoint**, with `interim_results`, `diarize`, `endpointing=300`, `utterance_end_ms=1000` and `mip_opt_out=true` (no use of our audio for model improvement). Reasons: German monolingual model, diarization included (needed in phase 3), fine-grained interim results for the live transcript, EU processing, $200 starting credit.
- **AssemblyAI** Universal-Streaming (multilingual model, EU endpoint) as the second adapter, tested against a fake server built from the documented message sequence; a turn is final only when `end_of_turn && turn_is_formatted`.
- **`stt-local`:** faster-whisper as the brief specifies, CPU `int8`, Silero VAD chunking (cut at a pause or after at most ~15 s), `language="de"`, model configurable (`LOCAL_STT_MODEL`, container default `small`, native recommendation `large-v3-turbo`). Same framing as the internal audio protocol (ADR 0015).
- **Mock:** plays a script of segments with timing (and, for stage 3, accepts any audio), deterministic.

## Alternatives

- **AssemblyAI as default:** cheaper per hour without diarization, but German only through the multilingual model and streaming diarization only with the pro model at extra cost. Second place; the eval can revisit it.
- **whisper.cpp or mlx-whisper for `stt-local`:** faster-whisper has **no Metal support**, so it runs on the CPU even natively on the Mac; whisper.cpp (Metal/Core ML) or mlx-whisper would use the GPU. That deviates from the brief, so it is not decided here. **Open question for the owner at Gate 0:** keep faster-whisper everywhere (portable, one engine), or add a Metal engine for the optional native mode later.
- **Provider SDKs vs. raw WebSocket:** SDKs where they support the EU host and streaming cleanly (`@deepgram/sdk` v5), otherwise the documented WebSocket protocol with `ws`; decided per adapter in T2.2, recorded in the adapter's header comment.

## Consequences

- New secrets `deepgram_api_key` and `assemblyai_api_key` (created empty by `secrets-init`, mounted only into `transcription`); `transcription` joins the `egress` network.
- The consent dialog lists the active STT provider (brief 15.6); the settings page shows it via `status:v1:transcription`.
- Cost per audio minute enters the daily budget; the eval report gains STT latency (time to final segment).
- If the real test shows poor German quality or slow finals, the default switches to AssemblyAI (config change only).
