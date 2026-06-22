"use strict";

/**
 * EventBridge イベントスキーマバリデーター
 *
 * Pattern A（スケジューラ）と Pattern B（S3 イベント駆動）の
 * EventBridge イベント構造を検証するユーティリティ。
 * ローカルテストや CI でのイベント構造確認に使用する。
 */

// ── 必須フィールド定義 ────────────────────────────────────────────

const COMMON_REQUIRED_FIELDS = ["version", "id", "source", "account", "time", "region", "detail-type", "detail"];

const S3_EVENT_REQUIRED_DETAIL_FIELDS = ["bucket", "object", "reason"];

const S3_BUCKET_REQUIRED_FIELDS = ["name"];

const S3_OBJECT_REQUIRED_FIELDS = ["key", "size"];

// ── バリデーション関数 ────────────────────────────────────────────

/**
 * EventBridge 共通フィールドを検証する
 * @param {object} event - EventBridge イベント
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCommonFields(event) {
  const errors = [];

  for (const field of COMMON_REQUIRED_FIELDS) {
    if (event[field] === undefined || event[field] === null || event[field] === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (event.version && event.version !== "0") {
    errors.push(`Invalid version: expected "0", got "${event.version}"`);
  }

  if (event.account && !/^\d{12}$/.test(event.account)) {
    errors.push(`Invalid account format: must be 12-digit string, got "${event.account}"`);
  }

  if (event.time && isNaN(Date.parse(event.time))) {
    errors.push(`Invalid time format: "${event.time}" is not a valid ISO 8601 datetime`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Pattern A: スケジューライベントを検証する
 * @param {object} event - EventBridge スケジューライベント
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSchedulerEvent(event) {
  const common = validateCommonFields(event);
  const errors = [...common.errors];

  if (event["detail-type"] && event["detail-type"] !== "Scheduled Event") {
    errors.push(`Invalid detail-type for scheduler: expected "Scheduled Event", got "${event["detail-type"]}"`);
  }

  if (event.source && event.source !== "aws.events") {
    errors.push(`Invalid source for scheduler: expected "aws.events", got "${event.source}"`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Pattern B: S3 イベント駆動イベントを検証する
 * @param {object} event - EventBridge S3 イベント
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateS3Event(event) {
  const common = validateCommonFields(event);
  const errors = [...common.errors];

  if (event["detail-type"] && event["detail-type"] !== "Object Created") {
    errors.push(`Invalid detail-type for S3 event: expected "Object Created", got "${event["detail-type"]}"`);
  }

  if (event.source && event.source !== "aws.s3") {
    errors.push(`Invalid source for S3 event: expected "aws.s3", got "${event.source}"`);
  }

  const detail = event.detail || {};

  for (const field of S3_EVENT_REQUIRED_DETAIL_FIELDS) {
    if (detail[field] === undefined) {
      errors.push(`Missing required detail field: ${field}`);
    }
  }

  if (detail.bucket) {
    for (const field of S3_BUCKET_REQUIRED_FIELDS) {
      if (!detail.bucket[field]) {
        errors.push(`Missing required bucket field: ${field}`);
      }
    }
  }

  if (detail.object) {
    for (const field of S3_OBJECT_REQUIRED_FIELDS) {
      if (detail.object[field] === undefined) {
        errors.push(`Missing required object field: ${field}`);
      }
    }
    if (detail.object.size !== undefined && detail.object.size < 0) {
      errors.push(`Invalid object size: must be >= 0, got ${detail.object.size}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * イベントタイプを自動判定してバリデーションを実行する
 * @param {object} event - EventBridge イベント
 * @returns {{ valid: boolean, type: string, errors: string[] }}
 */
function validateEvent(event) {
  if (!event || typeof event !== "object") {
    return { valid: false, type: "unknown", errors: ["Event must be a non-null object"] };
  }

  const detailType = event["detail-type"] || "";
  const source = event.source || "";

  if (source === "aws.s3" || detailType === "Object Created") {
    const result = validateS3Event(event);
    return { ...result, type: "s3" };
  }

  if (source === "aws.events" || detailType === "Scheduled Event") {
    const result = validateSchedulerEvent(event);
    return { ...result, type: "scheduler" };
  }

  const common = validateCommonFields(event);
  return { ...common, type: "unknown" };
}

module.exports = {
  validateEvent,
  validateSchedulerEvent,
  validateS3Event,
  validateCommonFields,
};
