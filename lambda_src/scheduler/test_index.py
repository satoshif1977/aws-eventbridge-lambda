"""
Pattern A スケジューラー Lambda ユニットテスト

S3 put_object をモックし、AWS 接続なしでレポート生成ロジックを検証する。
"""

import json
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from index import lambda_handler
from retry import RetryConfig


def make_context(function_name="scheduler", request_id="test-request-id"):
    ctx = MagicMock()
    ctx.function_name = function_name
    ctx.aws_request_id = request_id
    return ctx


class TestSchedulerLambda:
    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-report-bucket"})
    def test_正常系_200とreport_keyを返す(self, mock_s3):
        mock_s3.put_object.return_value = {}
        event = {"source": "aws.scheduler"}
        result = lambda_handler(event, make_context())

        assert result["statusCode"] == 200
        assert result["status"] == "success"
        assert "reports/" in result["report_key"]
        assert "daily-report.json" in result["report_key"]

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-report-bucket"})
    def test_S3にPUTされるレポートの構造(self, mock_s3):
        mock_s3.put_object.return_value = {}
        event = {}
        lambda_handler(event, make_context())

        call_kwargs = mock_s3.put_object.call_args.kwargs
        assert call_kwargs["Bucket"] == "test-report-bucket"
        assert "reports/" in call_kwargs["Key"]

        body = json.loads(call_kwargs["Body"])
        assert "report_date" in body
        assert "generated_at" in body
        assert body["source"] == "EventBridge Scheduler"

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-report-bucket"})
    def test_generated_atがJST形式(self, mock_s3):
        mock_s3.put_object.return_value = {}
        result = lambda_handler({}, make_context())
        assert "+09:00" in result["generated_at"]

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-report-bucket"})
    def test_S3のContentTypeがapplication_json(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())

        call_kwargs = mock_s3.put_object.call_args.kwargs
        assert call_kwargs["ContentType"] == "application/json"

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-report-bucket"})
    def test_lambda_function_nameがレポートに含まれる(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context(function_name="my-scheduler-fn"))

        body = json.loads(mock_s3.put_object.call_args.kwargs["Body"])
        assert body["lambda_function"] == "my-scheduler-fn"

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-report-bucket"})
    def test_report_keyが日付フォーマットに従う(self, mock_s3):
        mock_s3.put_object.return_value = {}
        result = lambda_handler({}, make_context())

        import re
        assert re.match(r"reports/\d{4}-\d{2}-\d{2}/daily-report\.json", result["report_key"])

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-report-bucket"})
    def test_messageフィールドに日付が含まれる(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())

        body = json.loads(mock_s3.put_object.call_args.kwargs["Body"])
        assert "の日次レポートを生成しました" in body["message"]

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-report-bucket"})
    def test_S3書き込みエラーは例外を伝播する(self, mock_s3):
        mock_s3.put_object.side_effect = Exception("S3 connection error")

        with pytest.raises(Exception, match="S3 connection error"):
            lambda_handler({}, make_context())


class TestS3リトライの結線:
    """put_object がリトライ経由で呼ばれていることを確認する。

    リトライを外す（index.py を s3.put_object(...) に戻す）と、
    このクラスのテストは落ちる。
    """

    @staticmethod
    def _slow_down():
        return ClientError(
            {
                "Error": {"Code": "SlowDown", "Message": "リクエストが多すぎます"},
                "ResponseMetadata": {"HTTPStatusCode": 503},
            },
            "PutObject",
        )

    @patch("index.retry_call")
    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_put_objectはretry_call経由で呼ばれる(self, mock_s3, mock_retry_call):
        result = lambda_handler({}, make_context())

        assert result["statusCode"] == 200
        mock_retry_call.assert_called_once()
        args, kwargs = mock_retry_call.call_args
        assert args[0] == mock_s3.put_object
        assert kwargs["Bucket"] == "test-bucket"
        assert kwargs["ContentType"] == "application/json"
        # retry_call に委譲しているので、put_object を直接呼んでいない
        mock_s3.put_object.assert_not_called()

    @patch("index.retry_call")
    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_SlowDownが再試行されて最終的に成功する(self, mock_s3, mock_retry_call):
        mock_s3.put_object.side_effect = [self._slow_down(), None]

        # 実待機ゼロで本物のリトライを通す
        from retry import retry_call as real_retry_call

        mock_retry_call.side_effect = lambda func, **kwargs: real_retry_call(
            func,
            config=RetryConfig(base_delay=0.01, max_delay=0.02, jitter=False),
            sleep=lambda _: None,
            **kwargs,
        )

        result = lambda_handler({}, make_context())

        assert result["statusCode"] == 200
        assert mock_s3.put_object.call_count == 2

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_リトライ不能なエラーは再試行せず伝播する(self, mock_s3):
        denied = ClientError(
            {
                "Error": {"Code": "AccessDenied", "Message": "権限がありません"},
                "ResponseMetadata": {"HTTPStatusCode": 403},
            },
            "PutObject",
        )
        mock_s3.put_object.side_effect = denied

        with pytest.raises(ClientError):
            lambda_handler({}, make_context())

        # リトライ対象外なので 1 回で諦める
        assert mock_s3.put_object.call_count == 1

    @patch("index.retry_call")
    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_リトライしてもレポート本文は変わらない(self, mock_s3, mock_retry_call):
        """Body は str なので、再送信しても内容が欠けない。"""
        bodies = []
        mock_s3.put_object.side_effect = lambda **kw: bodies.append(kw["Body"]) or (
            self._slow_down() if len(bodies) == 1 else None
        )

        def side(func, **kwargs):
            from retry import retry_call as real

            return real(
                func,
                config=RetryConfig(base_delay=0.01, max_delay=0.02, jitter=False),
                sleep=lambda _: None,
                **kwargs,
            )

        mock_retry_call.side_effect = side

        def put(**kw):
            bodies.append(kw["Body"])
            if len(bodies) == 1:
                raise self._slow_down()

        mock_s3.put_object.side_effect = put

        lambda_handler({}, make_context())

        assert len(bodies) == 2
        assert bodies[0] == bodies[1]
        assert json.loads(bodies[0])["source"] == "EventBridge Scheduler"
