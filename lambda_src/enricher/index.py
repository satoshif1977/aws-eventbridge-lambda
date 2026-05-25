"""
Pattern C: EventBridge Pipes エンリッチメント Lambda
SQS メッセージを受け取り、ファイルタイプと優先度を付与して返す。
Pipes のエンリッチメントとして使用するため、処理結果をそのまま return する。
"""
import json
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger()
logger.setLevel(logging.INFO)

JST = timezone(timedelta(hours=9))

# ファイルサイズによる優先度判定しきい値（1MB）
HIGH_PRIORITY_THRESHOLD_BYTES = 1_000_000

# 拡張子 → ファイル種別マッピング
EXT_TO_TYPE: dict[str, str] = {
    "csv": "csv",
    "json": "json",
    "xml": "xml",
    "txt": "text",
    "log": "log",
    "zip": "archive",
    "gz": "archive",
}


def _detect_file_type(key: str) -> str:
    """S3 オブジェクトキーから拡張子を取得してファイル種別を返す。"""
    if "." not in key:
        return "unknown"
    ext = key.rsplit(".", 1)[-1].lower()
    return EXT_TO_TYPE.get(ext, ext)


def _detect_priority(size: int) -> str:
    """ファイルサイズに基づいて処理優先度を判定する。"""
    return "high" if size >= HIGH_PRIORITY_THRESHOLD_BYTES else "normal"


def lambda_handler(event: dict | list, context) -> dict:
    """Pipes エンリッチメント: S3 ファイル情報にメタデータを付与する。

    Args:
        event: Pipes から渡された SQS メッセージ body（dict または list）
        context: Lambda コンテキスト

    Returns:
        file_type / priority / enriched_at を付与したエンリッチ済み dict
    """
    logger.info("エンリッチメント処理開始")
    logger.info("受信イベント: %s", json.dumps(event, ensure_ascii=False))

    # Pipes の input_template "<$.body>" により body が直接渡される
    body = event if isinstance(event, dict) else (event[0] if event else {})

    key = body.get("key", "")
    size = int(body.get("size", 0))

    enriched = {
        **body,
        "file_type": _detect_file_type(key),
        "priority": _detect_priority(size),
        "enriched_at": datetime.now(JST).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
    }

    logger.info(
        "エンリッチ完了: key=%s file_type=%s priority=%s",
        key,
        enriched["file_type"],
        enriched["priority"],
    )
    return enriched
