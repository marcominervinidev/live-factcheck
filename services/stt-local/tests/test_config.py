import pytest

from stt_local.config import ConfigError, load_settings


def test_defaults() -> None:
    settings = load_settings({})
    assert (settings.host, settings.port) == ("127.0.0.1", 8000)
    assert settings.model == "small"
    assert settings.compute_type == "int8"
    assert (settings.silence_ms, settings.max_chunk_ms) == (500, 15000)


def test_reads_values_and_treats_empty_as_unset() -> None:
    settings = load_settings(
        {
            "HOST": "stt-local",
            "PORT": "9000",
            "LOCAL_STT_MODEL": "large-v3-turbo",
            "LOCAL_STT_CPU_THREADS": "",
            "LOG_LEVEL": "debug",
        }
    )
    assert settings.host == "stt-local"
    assert (settings.port, settings.model, settings.cpu_threads, settings.log_level) == (
        9000,
        "large-v3-turbo",
        0,
        "debug",
    )


def test_names_every_invalid_variable() -> None:
    with pytest.raises(ConfigError) as caught:
        load_settings(
            {
                "HOST": "stt-local --reload",
                "PORT": "x",
                "LOCAL_STT_MODEL": "../../etc/passwd;rm",
                "LOCAL_STT_COMPUTE_TYPE": "float16",
                "LOCAL_STT_SILENCE_MS": "10",
            }
        )
    keys = [issue.split(":")[0] for issue in caught.value.issues]
    assert keys == [
        "LOCAL_STT_MODEL",
        "HOST",
        "PORT",
        "LOCAL_STT_COMPUTE_TYPE",
        "LOCAL_STT_SILENCE_MS",
    ]
