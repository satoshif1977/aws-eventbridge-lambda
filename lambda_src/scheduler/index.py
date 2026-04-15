"""
Pattern A: スケジュール実行 Lambda
EventBridge の定期ルール（毎日 9:00 JST）から起動し、
日次レポートを生成して S3 に保存する。
"""
import json
import logging
import os
from datetime import datetime, timezone, timedelta

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")

JST = timezone(timedelta(hours=9))


def lambda_handler(event: dict, context) -> dict:
    """EventBridge スケジュールイベントを受け取り、日次レポートを S3 に保存する。

    Args:
        event: EventBridge スケジュールイベント
        context: Lambda コンテキスト

    Returns:
        実行結果（status / report_key）
    """
    now = datetime.now(JST)
    date_str = now.strftime("%Y-%m-%d")
    timestamp_str = now.strftime("%Y-%m-%dT%H:%M:%S+09:00")

    logger.info("スケジュール実行開始: %s", timestamp_str)
    logger.info("受信イベント: %s", json.dumps(event))

    # ── レポート生成 ────────────────────────────────────────
    report = {
        "report_date": date_str,
        "generated_at": timestamp_str,
        "source": "EventBridge Scheduler",
        "message": f"{date_str} の日次レポートを生成しました。",
        "lambda_function": context.function_name,
        "lambda_request_id": context.aws_request_id,
    }

    # ── S3 に保存 ───────────────────────────────────────────
    bucket_name = os.environ["REPORT_BUCKET_NAME"]
    report_key = f"reports/{date_str}/daily-report.json"

    s3.put_object(
        Bucket=bucket_name,
        Key=report_key,
        Body=json.dumps(report, ensure_ascii=False, indent=2),
        ContentType="application/json",
    )

    logger.info("レポートを S3 に保存しました: s3://%s/%s", bucket_name, report_key)

    return {
        "statusCode": 200,
        "status": "success",
        "report_key": report_key,
        "generated_at": timestamp_str,
    }
