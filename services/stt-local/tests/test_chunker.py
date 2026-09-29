import struct

from stt_local.chunker import Chunker, ms_of, rms

FRAME_SAMPLES = 1600  # 100 ms at 16 kHz


def tone(amplitude: int = 8000) -> bytes:
    return struct.pack(
        f"<{FRAME_SAMPLES}h", *[amplitude if i % 2 else -amplitude for i in range(FRAME_SAMPLES)]
    )


def quiet() -> bytes:
    return bytes(FRAME_SAMPLES * 2)


def test_rms_and_duration() -> None:
    assert rms(b"") == 0.0
    assert rms(b"\x01") == 0.0
    assert rms(struct.pack("<4h", 300, -300, 300, -300)) == 300.0
    assert ms_of(3200) == 100


def test_cuts_a_chunk_after_the_pause_and_drops_leading_silence() -> None:
    chunker = Chunker(silence_ms=500, max_chunk_ms=15000)
    frames = [quiet()] * 3 + [tone()] * 10 + [quiet()] * 4
    assert [c for f in frames for c in chunker.feed(f)] == []

    chunks = chunker.feed(quiet())  # 500 ms of silence after speech
    assert len(chunks) == 1
    assert (chunks[0].start_ms, chunks[0].end_ms) == (300, 1800)
    assert len(chunks[0].pcm) == 15 * FRAME_SAMPLES * 2
    assert chunker.flush() is None


def test_cuts_long_speech_at_the_maximum_and_keeps_counting_time() -> None:
    chunker = Chunker(silence_ms=500, max_chunk_ms=2000)
    chunks = [c for _ in range(45) for c in chunker.feed(tone())]
    assert [(c.start_ms, c.end_ms) for c in chunks] == [(0, 2000), (2000, 4000)]
    rest = chunker.flush()
    assert rest is not None
    assert (rest.start_ms, rest.end_ms) == (4000, 4500)


def test_flush_returns_nothing_without_speech() -> None:
    chunker = Chunker(silence_ms=500, max_chunk_ms=15000)
    for _ in range(10):
        chunker.feed(quiet())
    assert chunker.flush() is None
