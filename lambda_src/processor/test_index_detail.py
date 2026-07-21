"""
Pattern B プロセッサー Lambda 詳細ユニットテスト

DynamoDB アイテムの細部・境界値・レスポンス構造を検証する。
"""

import re
from unittest.mock import MagicMock, call, patch

import pytest

from index import lambda_handler


def make_context(request_id="test-request-id"):
    ctx = MagicMock()
    ctx.aws_request_id = request_id
    return ctx


def make_s3_event(bucket="input-bucket", key="test.txt", size=100, time="2026-04-17T00:00:00Z"):
    return {
        "source": "aws.s3",
        "time": time,
        "detail": {
            "bucket": {"name": bucket},
            "object": {"key": key, "size": size},
        },
    }


# ── pk フォーマット検証 ──────────────────────────────────────────────


class TestProcessorItemPk:
    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_pkがs3スキームで正しく組み立てられる(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        lambda_handler(make_s3_event(bucket="my-bucket", key="data.csv"), make_context())

        item = mock_table.put_item.call_args.kwargs["Item"]
        assert item["pk"] == "s3://my-bucket/data.csv"

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_サブフォルダパスのpkが正しく組み立てられる(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        lambda_handler(make_s3_event(bucket="bucket", key="uploads/2026/data.json"), make_context())

        item = mock_table.put_item.call_args.kwargs["Item"]
        assert item["pk"] == "s3://bucket/uploads/2026/data.json"

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_pkにbucket_nameとobject_keyが含まれる(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        lambda_handler(make_s3_event(bucket="alpha", key="beta.txt"), make_context())

        item = mock_table.put_item.call_args.kwargs["Item"]
        assert "alpha" in item["pk"]
        assert "beta.txt" in item["pk"]


# ── タイムスタンプ・サイズ検証 ──────────────────────────────────────


class TestProcessorItemFields:
    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_processed_atがJST形式(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        lambda_handler(make_s3_event(), make_context())

        item = mock_table.put_item.call_args.kwargs["Item"]
        assert "+09:00" in item["processed_at"]
        assert re.match(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00", item["processed_at"])

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_object_sizeが0のとき正常処理される(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        result = lambda_handler(make_s3_event(size=0), make_context())

        assert result["statusCode"] == 200
        item = mock_table.put_item.call_args.kwargs["Item"]
        assert item["object_size"] == 0

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_巨大ファイルサイズが記録される(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        lambda_handler(make_s3_event(size=50_000_000_000), make_context())  # 50GB

        item = mock_table.put_item.call_args.kwargs["Item"]
        assert item["object_size"] == 50_000_000_000

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_timeフィールドがないとevent_timeは空文字(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        event = {"detail": {"bucket": {"name": "b"}, "object": {"key": "k.txt", "size": 1}}}
        lambda_handler(event, make_context())

        item = mock_table.put_item.call_args.kwargs["Item"]
        assert item["event_time"] == ""

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_アイテムに7つのフィールドが含まれる(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        lambda_handler(make_s3_event(), make_context())

        item = mock_table.put_item.call_args.kwargs["Item"]
        expected_keys = {"pk", "processed_at", "bucket_name", "object_key", "object_size", "event_time", "lambda_request_id"}
        assert expected_keys == set(item.keys())


# ── バリデーション境界値 ─────────────────────────────────────────────


class TestProcessorValidation:
    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_detailが存在しない場合は400(self, mock_dynamodb):
        mock_dynamodb.Table.return_value = MagicMock()
        result = lambda_handler({}, make_context())
        assert result["statusCode"] == 400

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_bucketキーが存在しない場合は400(self, mock_dynamodb):
        mock_dynamodb.Table.return_value = MagicMock()
        event = {"detail": {"object": {"key": "file.txt", "size": 100}}}
        result = lambda_handler(event, make_context())
        assert result["statusCode"] == 400

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_400レスポンスにmessageフィールドがある(self, mock_dynamodb):
        mock_dynamodb.Table.return_value = MagicMock()
        result = lambda_handler({}, make_context())
        assert "message" in result


# ── レスポンス構造検証 ──────────────────────────────────────────────


class TestProcessorResponse:
    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_レスポンスに必須フィールドがすべて含まれる(self, mock_dynamodb):
        mock_dynamodb.Table.return_value = MagicMock()
        result = lambda_handler(make_s3_event(), make_context())

        assert "statusCode" in result
        assert "status" in result
        assert "processed_count" in result
        assert "processed_key" in result

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_processed_countは常に1(self, mock_dynamodb):
        mock_dynamodb.Table.return_value = MagicMock()
        result = lambda_handler(make_s3_event(), make_context())
        assert result["processed_count"] == 1

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_statusはsuccess(self, mock_dynamodb):
        mock_dynamodb.Table.return_value = MagicMock()
        result = lambda_handler(make_s3_event(), make_context())
        assert result["status"] == "success"

    @patch("index.dynamodb")
    @patch.dict("os.environ", {"DYNAMODB_TABLE_NAME": "test-table"})
    def test_DynamoDBのput_itemが1回だけ呼ばれる(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_dynamodb.Table.return_value = mock_table

        lambda_handler(make_s3_event(), make_context())

        assert mock_table.put_item.call_count == 1
