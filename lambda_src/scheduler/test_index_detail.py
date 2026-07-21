"""
Pattern A スケジューラー Lambda 詳細ユニットテスト

S3 レポートの内容・構造・境界値を細部まで検証する。
"""

import json
import re
from unittest.mock import MagicMock, patch

import pytest

from index import lambda_handler


def make_context(function_name="scheduler", request_id="test-request-id"):
    ctx = MagicMock()
    ctx.function_name = function_name
    ctx.aws_request_id = request_id
    return ctx


# ── レポートボディの内容検証 ─────────────────────────────────────────


class TestSchedulerReportContent:
    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_lambda_request_idがレポートに記録される(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context(request_id="req-xyz-999"))

        body = json.loads(mock_s3.put_object.call_args.kwargs["Body"])
        assert body["lambda_request_id"] == "req-xyz-999"

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_report_dateがYYYY_MM_DD形式(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())

        body = json.loads(mock_s3.put_object.call_args.kwargs["Body"])
        assert re.match(r"\d{4}-\d{2}-\d{2}", body["report_date"])

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_sourceが固定文字列EventBridge_Scheduler(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())

        body = json.loads(mock_s3.put_object.call_args.kwargs["Body"])
        assert body["source"] == "EventBridge Scheduler"

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_レポートに6つのフィールドが含まれる(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())

        body = json.loads(mock_s3.put_object.call_args.kwargs["Body"])
        expected_keys = {"report_date", "generated_at", "source", "message", "lambda_function", "lambda_request_id"}
        assert expected_keys == set(body.keys())

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_messageにreport_dateと同じ日付が含まれる(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())

        body = json.loads(mock_s3.put_object.call_args.kwargs["Body"])
        assert body["report_date"] in body["message"]

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_generated_atがISO8601_JSTフォーマット(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())

        body = json.loads(mock_s3.put_object.call_args.kwargs["Body"])
        assert re.match(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00", body["generated_at"])

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_異なるfunction_nameが正しく記録される(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context(function_name="prod-daily-scheduler"))

        body = json.loads(mock_s3.put_object.call_args.kwargs["Body"])
        assert body["lambda_function"] == "prod-daily-scheduler"


# ── S3 インタラクション検証 ─────────────────────────────────────────


class TestSchedulerS3Interaction:
    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_put_objectが正確に1回だけ呼ばれる(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())
        assert mock_s3.put_object.call_count == 1

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "report-bucket-prod"})
    def test_env変数のバケット名がS3に渡される(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())

        kwargs = mock_s3.put_object.call_args.kwargs
        assert kwargs["Bucket"] == "report-bucket-prod"

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_BodyがJSON文字列として有効(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())

        body_str = mock_s3.put_object.call_args.kwargs["Body"]
        parsed = json.loads(body_str)
        assert isinstance(parsed, dict)

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_BodyがインデントされたJSON(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())

        body_str = mock_s3.put_object.call_args.kwargs["Body"]
        assert "\n" in body_str  # indent=2 によりに改行が入る

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_日本語messageがUTF8で保存される(self, mock_s3):
        mock_s3.put_object.return_value = {}
        lambda_handler({}, make_context())

        body_str = mock_s3.put_object.call_args.kwargs["Body"]
        # ensure_ascii=False → 日本語が \uXXXX にエスケープされない
        assert "日次レポートを生成しました" in body_str


# ── レスポンス構造検証 ──────────────────────────────────────────────


class TestSchedulerResponse:
    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_レスポンスに必須フィールドがすべて含まれる(self, mock_s3):
        mock_s3.put_object.return_value = {}
        result = lambda_handler({}, make_context())

        assert "statusCode" in result
        assert "status" in result
        assert "report_key" in result
        assert "generated_at" in result

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_statusCodeは200(self, mock_s3):
        mock_s3.put_object.return_value = {}
        result = lambda_handler({}, make_context())
        assert result["statusCode"] == 200

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_statusはsuccess(self, mock_s3):
        mock_s3.put_object.return_value = {}
        result = lambda_handler({}, make_context())
        assert result["status"] == "success"

    @patch("index.s3")
    @patch.dict("os.environ", {"REPORT_BUCKET_NAME": "test-bucket"})
    def test_イベントの内容に関わらず正常実行される(self, mock_s3):
        mock_s3.put_object.return_value = {}
        # EventBridge のペイロードは handler 内で使用しないため何でもよい
        for event in [{}, {"source": "aws.scheduler"}, {"detail": {}}, None or {}]:
            result = lambda_handler(event, make_context())
            assert result["statusCode"] == 200
