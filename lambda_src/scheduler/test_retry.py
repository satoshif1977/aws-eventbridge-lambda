"""
scheduler Lambda のリトライユーティリティ ユニットテスト

sleep / rand を注入して、実待機ゼロかつ決定的に検証する。
"""

import pytest
from botocore.exceptions import ClientError, ConnectTimeoutError, ReadTimeoutError

from retry import (
    DEFAULT_CONFIG,
    RetryConfig,
    compute_delay,
    extract_error_code,
    extract_status_code,
    is_retryable,
    retry_call,
    with_retry,
)


def make_client_error(code: str = "ThrottlingException", status: int = 400):
    """指定のエラーコード／ステータスコードを持つ ClientError を作る。"""
    return ClientError(
        {
            "Error": {"Code": code, "Message": "テスト用のエラーです"},
            "ResponseMetadata": {"HTTPStatusCode": status},
        },
        "PutObject",
    )


class NoSleep:
    """sleep の差し替え。待機せずに呼ばれた秒数だけ記録する。"""

    def __init__(self):
        self.calls: list[float] = []

    def __call__(self, delay: float) -> None:
        self.calls.append(delay)


class TestRetryConfig:
    def test_既定値は3回試行でジッター有効(self):
        assert DEFAULT_CONFIG.max_attempts == 3
        assert DEFAULT_CONFIG.base_delay == 0.5
        assert DEFAULT_CONFIG.max_delay == 8.0
        assert DEFAULT_CONFIG.jitter is True

    @pytest.mark.parametrize(
        "kwargs",
        [
            {"max_attempts": 0},
            {"base_delay": 0},
            {"base_delay": -1.0},
            {"base_delay": 2.0, "max_delay": 1.0},
        ],
    )
    def test_不正な設定はValueError(self, kwargs):
        with pytest.raises(ValueError):
            RetryConfig(**kwargs)


class TestExtractors:
    def test_ClientErrorからエラーコードを取り出す(self):
        assert extract_error_code(make_client_error("SlowDown")) == "SlowDown"

    def test_ClientErrorからステータスコードを取り出す(self):
        assert extract_status_code(make_client_error(status=503)) == 503

    def test_ClientError以外は空文字とNone(self):
        exc = ValueError("まったく別の例外")
        assert extract_error_code(exc) == ""
        assert extract_status_code(exc) is None

    def test_responseが壊れていても落ちない(self):
        exc = make_client_error()
        exc.response = "辞書ではない値"
        assert extract_error_code(exc) == ""
        assert extract_status_code(exc) is None


class TestIsRetryable:
    @pytest.mark.parametrize(
        "code",
        [
            "ThrottlingException",
            "ProvisionedThroughputExceededException",
            "InternalError",
            "ServiceUnavailable",
            "RequestTimeout",
            "SlowDown",
        ],
    )
    def test_スロットリング系はリトライ対象(self, code):
        assert is_retryable(make_client_error(code)) is True

    @pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
    def test_429と5xxはリトライ対象(self, status):
        assert is_retryable(make_client_error("UnknownCode", status)) is True

    @pytest.mark.parametrize(
        "code",
        ["ValidationException", "AccessDeniedException", "ResourceNotFoundException"],
    )
    def test_恒久的なエラーはリトライしない(self, code):
        assert is_retryable(make_client_error(code, 400)) is False

    def test_ネットワーク層の一時障害はリトライ対象(self):
        assert (
            is_retryable(ConnectTimeoutError(endpoint_url="https://example.com"))
            is True
        )
        assert (
            is_retryable(ReadTimeoutError(endpoint_url="https://example.com")) is True
        )

    def test_AWS以外の例外はリトライしない(self):
        assert is_retryable(ValueError("業務エラー")) is False


class TestComputeDelay:
    def test_ジッター無効なら指数バックオフになる(self):
        config = RetryConfig(base_delay=0.5, max_delay=8.0, jitter=False)
        assert compute_delay(1, config) == 0.5
        assert compute_delay(2, config) == 1.0
        assert compute_delay(3, config) == 2.0
        assert compute_delay(4, config) == 4.0

    def test_max_delayで頭打ちになる(self):
        config = RetryConfig(base_delay=1.0, max_delay=3.0, jitter=False)
        assert compute_delay(10, config) == 3.0

    def test_試行回数が巨大でも桁あふれしない(self):
        config = RetryConfig(base_delay=1.0, max_delay=5.0, jitter=False)
        assert compute_delay(10**6, config) == 5.0

    def test_ジッター有効なら0から上限の範囲に散る(self):
        config = RetryConfig(base_delay=1.0, max_delay=8.0, jitter=True)
        assert compute_delay(3, config, rand=lambda: 0.0) == 0.0
        assert compute_delay(3, config, rand=lambda: 1.0) == 4.0
        assert compute_delay(3, config, rand=lambda: 0.5) == 2.0

    def test_attemptが0以下ならValueError(self):
        with pytest.raises(ValueError):
            compute_delay(0)


class TestRetryCall:
    def test_初回で成功すればリトライしない(self):
        sleep = NoSleep()
        calls = []

        def ok():
            calls.append(1)
            return "成功"

        assert retry_call(ok, sleep=sleep) == "成功"
        assert len(calls) == 1
        assert sleep.calls == []

    def test_スロットリング後に成功する(self):
        sleep = NoSleep()
        attempts = []

        def flaky():
            attempts.append(1)
            if len(attempts) < 3:
                raise make_client_error("ThrottlingException")
            return "回復"

        result = retry_call(
            flaky,
            config=RetryConfig(base_delay=0.1, max_delay=1.0, jitter=False),
            sleep=sleep,
        )
        assert result == "回復"
        assert len(attempts) == 3
        assert sleep.calls == [0.1, 0.2]

    def test_リトライ不能な例外は即座に再送出する(self):
        sleep = NoSleep()
        attempts = []

        def denied():
            attempts.append(1)
            raise make_client_error("AccessDeniedException", 403)

        with pytest.raises(ClientError) as exc_info:
            retry_call(denied, sleep=sleep)

        assert len(attempts) == 1
        assert sleep.calls == []
        assert extract_error_code(exc_info.value) == "AccessDeniedException"

    def test_試行回数を使い切ったら元の例外を送出する(self):
        sleep = NoSleep()
        attempts = []

        def always_throttled():
            attempts.append(1)
            raise make_client_error("ProvisionedThroughputExceededException")

        with pytest.raises(ClientError) as exc_info:
            retry_call(
                always_throttled,
                config=RetryConfig(max_attempts=3, base_delay=0.1, jitter=False),
                sleep=sleep,
            )

        # 初回 + リトライ2回 = 3 回呼ばれ、待機は 2 回
        assert len(attempts) == 3
        assert len(sleep.calls) == 2
        assert (
            extract_error_code(exc_info.value)
            == "ProvisionedThroughputExceededException"
        )

    def test_引数はそのまま渡される(self):
        received = {}

        def put(**kwargs):
            received.update(kwargs)
            return "ok"

        retry_call(
            put, Bucket="b", Key="reports/2026-10-26/daily-report.json", sleep=NoSleep()
        )
        assert received == {
            "Bucket": "b",
            "Key": "reports/2026-10-26/daily-report.json",
        }

    def test_on_retryフックに試行回数と待機秒数が渡る(self):
        sleep = NoSleep()
        hooks: list[tuple[int, float, str]] = []
        attempts = []

        def flaky():
            attempts.append(1)
            if len(attempts) < 3:
                raise make_client_error("SlowDown")
            return "ok"

        retry_call(
            flaky,
            config=RetryConfig(base_delay=0.1, max_delay=1.0, jitter=False),
            sleep=sleep,
            on_retry=lambda a, d, e: hooks.append((a, d, extract_error_code(e))),
        )

        assert hooks == [(1, 0.1, "SlowDown"), (2, 0.2, "SlowDown")]

    def test_max_attemptsが1ならリトライしない(self):
        sleep = NoSleep()
        attempts = []

        def throttled():
            attempts.append(1)
            raise make_client_error("ThrottlingException")

        with pytest.raises(ClientError):
            retry_call(throttled, config=RetryConfig(max_attempts=1), sleep=sleep)

        assert len(attempts) == 1
        assert sleep.calls == []


class TestWithRetry:
    def test_デコレータとして使える(self):
        sleep = NoSleep()
        attempts = []

        @with_retry(
            config=RetryConfig(base_delay=0.1, max_delay=1.0, jitter=False),
            sleep=sleep,
        )
        def flaky(value: str) -> str:
            attempts.append(1)
            if len(attempts) < 2:
                raise make_client_error("ThrottlingException")
            return value

        assert flaky("ok") == "ok"
        assert len(attempts) == 2
        assert sleep.calls == [0.1]

    def test_関数のメタ情報が保たれる(self):
        @with_retry()
        def 元の関数() -> None:
            """説明文です。"""

        assert 元の関数.__name__ == "元の関数"
        assert 元の関数.__doc__ == "説明文です。"
        assert hasattr(元の関数, "__wrapped__")
