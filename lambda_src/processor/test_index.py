"""
Pattern B プロセッサー Lambda ユニットテスト

DynamoDB put_item をモックし、AWS 接続なしでイベント処理ロジックを検証する。
"""

from unittest.mock import MagicMock, patch

import pytest

from index import lambda_handler


def make_context(request_id="test-request-id"):
    ctx = MagicMock()
    ctx.aws_request_id = request_id
    return ctx


def make_s3_event(bucket="input-bucket", key="test.txt", size=100):
    return {
        "source": "aws.s3",
        "time": "2026-04-17T00:00:00Z",
        "detail": {
            "bucket": {"name": bucket},
            "object": {"key": key, "size": size},
        },
    }


class TestProcessorLambda:
    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_正常系_200とprocessed_keyを返す(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        result = lambda_handler(make_s3_event(), make_context())

        assert result["statusCode"] == 200
        assert result["status"] == "success"
        assert result["processed_count"] == 1
        assert result["processed_key"] == "test.txt"

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_DynamoDBに正しいアイテムが書き込まれる(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        lambda_handler(make_s3_event(bucket="my-bucket", key="data.csv", size=512), make_context())

        put_item_call = mock_table.put_item.call_args.kwargs["Item"]
        assert put_item_call["pk"] == "s3://my-bucket/data.csv"
        assert put_item_call["bucket_name"] == "my-bucket"
        assert put_item_call["object_key"] == "data.csv"
        assert put_item_call["object_size"] == 512
        assert "+09:00" in put_item_call["processed_at"]

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_バケット名なしのイベントは400を返す(self, mock_dynamodb):
        mock_dynamodb.Table.return_value = MagicMock()
        event = {"detail": {}}
        result = lambda_handler(event, make_context())
        assert result["statusCode"] == 400

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_オブジェクトキーなしのイベントは400を返す(self, mock_dynamodb):
        mock_dynamodb.Table.return_value = MagicMock()
        event = {"detail": {"bucket": {"name": "my-bucket"}, "object": {"key": ""}}}
        result = lambda_handler(event, make_context())
        assert result["statusCode"] == 400

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_lambda_request_idがアイテムに記録される(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        lambda_handler(make_s3_event(), make_context(request_id="req-abc-123"))

        item = mock_table.put_item.call_args.kwargs["Item"]
        assert item["lambda_request_id"] == "req-abc-123"

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_event_timeがアイテムに記録される(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        event = make_s3_event()
        lambda_handler(event, make_context())

        item = mock_table.put_item.call_args.kwargs["Item"]
        assert item["event_time"] == "2026-04-17T00:00:00Z"

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_日本語ファイル名のキーを正しく処理する(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        event = make_s3_event(bucket="my-bucket", key="uploads/テスト資料.pdf", size=2048)
        result = lambda_handler(event, make_context())

        assert result["statusCode"] == 200
        assert result["processed_key"] == "uploads/テスト資料.pdf"

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_DynamoDB書き込みエラーは例外を伝播する(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_table.put_item.side_effect = Exception("DynamoDB connection error")
        mock_dynamodb.Table.return_value = mock_table

        with pytest.raises(Exception, match="DynamoDB connection error"):
            lambda_handler(make_s3_event(), make_context())
