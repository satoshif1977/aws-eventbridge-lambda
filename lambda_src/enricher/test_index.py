"""
Pattern C エンリッチメント Lambda ユニットテスト

AWS 接続なしでファイル種別判定・優先度判定・ハンドラーロジックを検証する。
"""

from unittest.mock import MagicMock

import pytest

from index import (
    HIGH_PRIORITY_THRESHOLD_BYTES,
    _detect_file_type,
    _detect_priority,
    lambda_handler,
)


# ── _detect_file_type テスト ──────────────────────────────────


class TestDetectFileType:
    @pytest.mark.parametrize(
        "key, expected",
        [
            ("data.csv", "csv"),
            ("report.json", "json"),
            ("config.xml", "xml"),
            ("readme.txt", "text"),
            ("app.log", "log"),
            ("archive.zip", "archive"),
            ("backup.gz", "archive"),
            ("photo.jpg", "jpg"),           # 未知の拡張子はそのまま返す
            ("file.PDF", "pdf"),            # 大文字は小文字に正規化
            ("noextension", "unknown"),     # 拡張子なしは unknown
            ("nested/path/data.csv", "csv"),  # パスを含む場合も動作する
        ],
    )
    def test_拡張子からファイル種別を判定する(self, key, expected):
        assert _detect_file_type(key) == expected

    def test_ドットが複数ある場合は最後の拡張子を使う(self):
        # "archive.tar.gz" の最後の拡張子 "gz" → EXT_TO_TYPE["gz"] = "archive"
        assert _detect_file_type("archive.tar.gz") == "archive"

    def test_空文字列は_unknown(self):
        assert _detect_file_type("") == "unknown"

    def test_ドットで始まるファイル名(self):
        # ".gitignore" → 拡張子なしとして扱う（先頭ドットのみ）
        result = _detect_file_type(".gitignore")
        # "." in ".gitignore" → True なので rsplit → ext = "gitignore"
        # マッピングにないため "gitignore" を返す
        assert result == "gitignore"


# ── _detect_priority テスト ───────────────────────────────────


class TestDetectPriority:
    def test_閾値未満はnormal(self):
        assert _detect_priority(HIGH_PRIORITY_THRESHOLD_BYTES - 1) == "normal"

    def test_閾値以上はhigh(self):
        assert _detect_priority(HIGH_PRIORITY_THRESHOLD_BYTES) == "high"

    def test_閾値より大きいはhigh(self):
        assert _detect_priority(HIGH_PRIORITY_THRESHOLD_BYTES + 1) == "high"

    def test_ゼロはnormal(self):
        assert _detect_priority(0) == "normal"

    def test_大きなファイルはhigh(self):
        assert _detect_priority(1_000_000_000) == "high"  # 1GB


# ── lambda_handler テスト ─────────────────────────────────────


def make_context():
    ctx = MagicMock()
    ctx.aws_request_id = "test-request-id"
    return ctx


class TestLambdaHandler:
    def test_正常系_dictイベントはエンリッチされて返る(self):
        event = {"key": "data.csv", "size": 512}
        result = lambda_handler(event, make_context())

        assert result["key"] == "data.csv"
        assert result["size"] == 512
        assert result["file_type"] == "csv"
        assert result["priority"] == "normal"
        assert "+09:00" in result["enriched_at"]

    def test_正常系_高優先度ファイルはhighが返る(self):
        event = {"key": "large.zip", "size": HIGH_PRIORITY_THRESHOLD_BYTES + 1}
        result = lambda_handler(event, make_context())

        assert result["file_type"] == "archive"
        assert result["priority"] == "high"

    def test_正常系_listイベントは先頭要素を使う(self):
        event = [{"key": "report.json", "size": 100}]
        result = lambda_handler(event, make_context())

        assert result["key"] == "report.json"
        assert result["file_type"] == "json"

    def test_正常系_空リストイベントはkeyなしで返る(self):
        result = lambda_handler([], make_context())

        assert result["file_type"] == "unknown"  # key="" → unknown
        assert result["priority"] == "normal"    # size=0 → normal

    def test_元のフィールドが保持される(self):
        event = {"key": "data.txt", "size": 50, "bucket": "my-bucket", "extra": "value"}
        result = lambda_handler(event, make_context())

        assert result["bucket"] == "my-bucket"
        assert result["extra"] == "value"

    def test_enriched_atが付与される(self):
        event = {"key": "data.txt", "size": 100}
        result = lambda_handler(event, make_context())

        assert "enriched_at" in result
        assert "T" in result["enriched_at"]  # ISO 8601 形式

    def test_sizeが文字列数値でも動作する(self):
        # SQS body 経由で文字列になる場合
        event = {"key": "file.log", "size": "2000000"}
        result = lambda_handler(event, make_context())

        # int("2000000") = 2000000 > 1000000 → high
        assert result["priority"] == "high"
        assert result["file_type"] == "log"
