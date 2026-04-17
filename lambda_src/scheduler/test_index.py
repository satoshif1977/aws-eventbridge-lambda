"""
Pattern A スケジューラー Lambda ユニットテスト

S3 put_object をモックし、AWS 接続なしでレポート生成ロジックを検証する。
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from index import lambda_handler


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
