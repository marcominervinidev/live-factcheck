# Audio capture in the browser (research, 2026-09-29)

Sources: MDN (Web Audio API, AudioWorklet, MediaDevices), WebKit release notes, Playwright docs (fake media flags, `page.routeWebSocket`). Items marked **verify** are checked on the real iPhone in T6/T7 (`docs/testing/iphone-smoke.md`), because Playwright's WebKit is not Safari on iOS (brief 13.6).

## Capture pipeline

1. `navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })` – only in a secure context (HTTPS via Caddy; `http://localhost` on the Mac).
2. `new AudioContext()` **inside the click handler** of the start button (iOS allows audio only after a user gesture; a context created earlier stays `suspended` → `await context.resume()`).
3. `await context.audioWorklet.addModule('/worklets/pcm16.js')` – the worklet file is served by nginx from the same origin (CSP `script-src 'self'` allows it; no `blob:` URL needed).
4. `MediaStreamAudioSourceNode` → `AudioWorkletNode('pcm16')`. The worklet receives 128-sample Float32 blocks at the context's rate (usually 48 kHz on iOS, 44.1/48 kHz on Macs), **resamples to 16 kHz**, converts to Int16 LE, collects 1600 samples (100 ms = 3200 bytes) and posts an `ArrayBuffer` (transferable) to the main thread.
5. Main thread sends each buffer as a binary WebSocket message.

Resampling in the worklet rather than `new AudioContext({ sampleRate: 16000 })`: the constructor option works in current Safari/Chrome, but a forced context rate on iOS has caused glitches and differs from the hardware rate (**verify**); a simple linear/averaging downsampler is enough for speech and is unit-testable as a pure function.

## iOS/Safari specifics

- Microphone permission prompt appears per origin; with an installed PWA (home screen) the prompt can reappear per launch (**verify**).
- Screen lock / app switch: iOS suspends the page; capture stops without a clear event. Handle `visibilitychange` (→ hidden) and the `MediaStreamTrack` `ended`/`mute` events: stop the recording cleanly, send `audio.stop`, show "Aufnahme unterbrochen". No background recording in a web app (**verify**).
- `AudioContext` can be interrupted by calls or other audio (`state` becomes `interrupted` on Safari) → treat like a stop.
- Keep the WebSocket alive during recording; the gateway already reconnects with backoff, but a reconnect ends the recording (a new session) – the UI says so.

## Frame budget

- 16 kHz × 2 bytes × 0.1 s = **3200 bytes per 100 ms**, i.e. 32 KB/s upstream. The gateway accepts at most 8 KiB per frame and ~20 frames/s (headroom for jitter/batching).

## Testing

- **Chromium:** `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture=<wav>` (WAV, 16-bit PCM; Chromium loops the file) – stage 4 live mode with a German WAV fixture.
- **WebKit:** no fake-device flags. An init script replaces `navigator.mediaDevices.getUserMedia` with a stream from `AudioContext.createMediaStreamDestination()` that plays the fixture via an `AudioBufferSourceNode` (fixture fetched from the preview server).
- **Stage 2b:** `page.routeWebSocket('**/ws/session', …)` mocks the gateway (auth → `session.ready`, `audio.start` → `audio.started`, then scripted `transcript.segment`/`claim.*` events); the test asserts that binary frames of the right size arrive.
- **Unit:** the resampler and Int16 conversion as pure functions (Vitest); the worklet itself only in 2b/4.
- Fixture: a short German WAV (16 kHz mono, a few sentences incl. one clearly false claim), self-recorded or synthesised, license noted in `evals/SOURCES.md` / the fixture README.

## Links

- https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- https://playwright.dev/docs/api/class-page#page-route-web-socket
- https://peter.sh/experiments/chromium-command-line-switches/#use-file-for-fake-audio-capture
