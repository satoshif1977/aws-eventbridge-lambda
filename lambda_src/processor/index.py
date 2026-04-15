"""
Pattern B: S3 イベント駆動 Lambda
S3 にファイルがアップロードされると EventBridge 経由で起動し、
ファイル情報を DynamoDB に記録する。
"""
import json
import logging
import os
from datetime import datetime, timezone, timedelta

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb")

JST = timezone(timedelta(hours=9))


def lambda_handler(event: dict, context) -> dict:
    """EventBridge 経由の S3 イベントを受け取り、ファイル情報を DynamoDB に記録する。

    Args:
        event: EventBridge S3 イベント通知
        context: Lambda コンテキスト

    Returns:
        処理件数（processed_count）
    """
    logger.info("S3 イベント処理開始")
    logger.info("受信イベント: %s", json.dumps(event))

    table = dynamodb.Table(os.environ["DYNAMODB_TABLE_NAME"])
    now = datetime.now(JST)
    processed_count = 0

    # ── EventBridge 経由の S3 イベントを処理 ────────────────
    detail = event.get("detail", {})
    bucket_name = detail.get("bucket", {}).get("name", "")
    object_key = detail.get("object", {}).get("key", "")
    object_size = detail.get("object", {}).get("size", 0)

    if not bucket_name or not object_key:
        logger.warning("バケット名またはオブジェクトキーが取得できませんでした")
        return {"statusCode": 400, "message": "Invalid event structure"}

    logger.info("処理対象: s3://%s/%s (%d bytes)", bucket_name, object_key, object_size)

    # ── DynamoDB に記録 ─────────────────────────────────────
    item = {
        "pk": f"s3://{bucket_name}/{object_key}",
        "processed_at": now.strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "bucket_name": bucket_name,
        "object_key": object_key,
        "object_size": object_size,
        "event_time": event.get("time", ""),
        "lambda_request_id": context.aws_request_id,
    }

    table.put_item(Item=item)
    processed_count += 1

    logger.info("DynamoDB に記録しました: pk=%s", item["pk"])

    return {
        "statusCode": 200,
        "status": "success",
        "processed_count": processed_count,
        "processed_key": object_key,
    }
