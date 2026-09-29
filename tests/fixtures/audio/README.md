# Audio fixtures

| File | Content | Format | Origin |
|---|---|---|---|
| `conversation.de.wav` | 19.2 s, two speakers: "Guten Abend und willkommen zur Diskussion. Der Zweite Weltkrieg endete im Jahr 1965." (Anna) – "Das sehe ich anders. Berlin hat ungefähr 3,9 Millionen Einwohner." (Eddy) – "Und die Mondlandung fand 1975 statt." (Anna); 1 s silence after each turn | WAV, PCM 16-bit LE, mono, 16 kHz | Synthetic speech, generated on 2026-09-29 with the macOS voices Anna and Eddy (`say`) and converted with `afconvert`; no real person's voice |

Uses: `make stt-probe` (real STT provider, plan T2.5), later stage 4 live mode (Chromium fake audio, WebKit synthetic MediaStream; plan TP7).

The macOS system voices may be used to create content for personal, non-commercial projects; this repository is a non-commercial portfolio project. Replace the file with a self-recorded one if that ever changes.
