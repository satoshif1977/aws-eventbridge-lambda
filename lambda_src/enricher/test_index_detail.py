"""
Pattern C エンリッチメント Lambda 詳細ユニットテスト

_detect_file_type のエッジケース・lambda_handler の詳細動作を検証する。
"""

import re
from unittest.mock import MagicMock


from index import (
    EXT_TO_TYPE,
    HIGH_PRIORITY_THRESHOLD_BYTES,
    _detect_file_type,
    _detect_priority,
    lambda_handler,
)


def make_context():
    ctx = MagicMock()
    ctx.aws_request_id = "test-request-id"
    return ctx


# ── _detect_file_type エッジケース ───────────────────────────────


class TestDetectFileTypeEdgeCases:
    def test_スペースを含むキー名でも拡張子を取得できる(self):
        assert _detect_file_type("my file.csv") == "csv"

    def test_日本語ファイル名でも拡張子を取得できる(self):
        assert _detect_file_type("データ一覧.json") == "json"

    def test_ディレクトリ名にドットがあっても末尾拡張子を取得できる(self):
        # "path.with.dots/file.log" → rsplit(".", 1)[-1] = "log"
        assert _detect_file_type("path.with.dots/file.log") == "log"

    def test_多層パスでも正しい拡張子を取得できる(self):
        assert _detect_file_type("a/b/c/d/e/data.xml") == "xml"

    def test_EXT_TO_TYPEの全マッピングが正しく変換される(self):
        for ext, expected in EXT_TO_TYPE.items():
            result = _detect_file_type(f"test.{ext}")
            assert result == expected, f"ext={ext}: expected {expected}, got {result}"

    def test_複数ドット後のtxt拡張子はtext(self):
        # "a.b.c.txt" → last ext = "txt" → "text"
        assert _detect_file_type("a.b.c.txt") == "text"

    def test_数字を含むキー名でも動作する(self):
        assert _detect_file_type("backup_20260810.zip") == "archive"


# ── _detect_priority 境界値詳細 ─────────────────────────────────


class TestDetectPriorityDetail:
    def test_500000はnormal(self):
        assert _detect_priority(500_000) == "normal"

    def test_1234567はhigh(self):
        assert _detect_priority(1_234_567) == "high"


# ── lambda_handler 詳細 ──────────────────────────────────────────


class TestLambdaHandlerDetail:
    def test_listに複数要素がある場合は先頭のみ使用される(self):
        event = [{"key": "first.csv", "size": 100}, {"key": "second.json", "size": 200}]
        result = lambda_handler(event, make_context())
        assert result["key"] == "first.csv"
        assert result["file_type"] == "csv"

    def test_enriched_atがISO8601_JSTフォーマット(self):
        result = lambda_handler({"key": "data.csv", "size": 100}, make_context())
        assert re.match(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00", result["enriched_at"]
        )

    def test_元のdictオブジェクトは変更されない(self):
        event = {"key": "data.csv", "size": 100}
        original_keys = set(event.keys())
        lambda_handler(event, make_context())
        assert set(event.keys()) == original_keys

    def test_xmlファイルのfile_typeはxml(self):
        result = lambda_handler({"key": "config.xml", "size": 100}, make_context())
        assert result["file_type"] == "xml"

    def test_gzファイルのfile_typeはarchive(self):
        result = lambda_handler({"key": "backup.tar.gz", "size": 100}, make_context())
        assert result["file_type"] == "archive"

    def test_logファイルのfile_typeはlog(self):
        result = lambda_handler({"key": "app.log", "size": 100}, make_context())
        assert result["file_type"] == "log"

    def test_ちょうど閾値のsizeはhigh優先度(self):
        result = lambda_handler(
            {"key": "large.csv", "size": HIGH_PRIORITY_THRESHOLD_BYTES}, make_context()
        )
        assert result["priority"] == "high"

    def test_多くの追加フィールドがすべて保持される(self):
        event = {
            "key": "data.csv",
            "size": 50,
            "bucket": "my-bucket",
            "region": "ap-northeast-1",
            "account": "123456789012",
            "tag": "production",
        }
        result = lambda_handler(event, make_context())
        assert result["bucket"] == "my-bucket"
        assert result["region"] == "ap-northeast-1"
        assert result["account"] == "123456789012"
        assert result["tag"] == "production"

    def test_返り値に3つの新フィールドが追加される(self):
        event = {"key": "data.csv", "size": 100}
        result = lambda_handler(event, make_context())
        assert "file_type" in result
        assert "priority" in result
        assert "enriched_at" in result

    def test_txtファイルのfile_typeはtext(self):
        result = lambda_handler({"key": "readme.txt", "size": 100}, make_context())
        assert result["file_type"] == "text"
