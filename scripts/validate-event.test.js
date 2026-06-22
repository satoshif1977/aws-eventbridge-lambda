"use strict";

const { validateEvent, validateSchedulerEvent, validateS3Event, validateCommonFields } = require("./validate-event");

// ── テストフィクスチャ ────────────────────────────────────────────

const validSchedulerEvent = {
  version: "0",
  id: "12345678-1234-1234-1234-123456789012",
  "detail-type": "Scheduled Event",
  source: "aws.events",
  account: "363076773774",
  time: "2026-06-22T00:00:00Z",
  region: "ap-northeast-1",
  detail: {},
};

const validS3Event = {
  version: "0",
  id: "abcdef12-abcd-abcd-abcd-abcdef123456",
  "detail-type": "Object Created",
  source: "aws.s3",
  account: "363076773774",
  time: "2026-06-22T09:00:00Z",
  region: "ap-northeast-1",
  detail: {
    bucket: { name: "sadokisen-tokyo-prd-applog-s3-x8am305r" },
    object: { key: "logs/2026-06-22/app.log", size: 1024 },
    reason: "PutObject",
  },
};

// ── validateCommonFields ──────────────────────────────────────────

describe("validateCommonFields", () => {
  test("有効なスケジューライベントはエラーなし", () => {
    const result = validateCommonFields(validSchedulerEvent);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("有効な S3 イベントはエラーなし", () => {
    const result = validateCommonFields(validS3Event);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("version が '0' 以外はエラー", () => {
    const event = { ...validSchedulerEvent, version: "1" };
    const result = validateCommonFields(event);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid version: expected "0", got "1"');
  });

  test("account が 12 桁以外はエラー", () => {
    const event = { ...validSchedulerEvent, account: "12345" };
    const result = validateCommonFields(event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("account"))).toBe(true);
  });

  test("time が不正な日時形式はエラー", () => {
    const event = { ...validSchedulerEvent, time: "not-a-date" };
    const result = validateCommonFields(event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("time"))).toBe(true);
  });

  test("必須フィールドが欠けているとエラー", () => {
    const { id: _, ...eventWithoutId } = validSchedulerEvent;
    const result = validateCommonFields(eventWithoutId);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: id");
  });
});

// ── validateSchedulerEvent ───────────────────────────────────────

describe("validateSchedulerEvent", () => {
  test("有効なスケジューライベントはエラーなし", () => {
    const result = validateSchedulerEvent(validSchedulerEvent);
    expect(result.valid).toBe(true);
  });

  test("detail-type が 'Scheduled Event' 以外はエラー", () => {
    const event = { ...validSchedulerEvent, "detail-type": "Custom Event" };
    const result = validateSchedulerEvent(event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("detail-type"))).toBe(true);
  });

  test("source が 'aws.events' 以外はエラー", () => {
    const event = { ...validSchedulerEvent, source: "aws.s3" };
    const result = validateSchedulerEvent(event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("source"))).toBe(true);
  });
});

// ── validateS3Event ───────────────────────────────────────────────

describe("validateS3Event", () => {
  test("有効な S3 イベントはエラーなし", () => {
    const result = validateS3Event(validS3Event);
    expect(result.valid).toBe(true);
  });

  test("detail-type が 'Object Created' 以外はエラー", () => {
    const event = { ...validS3Event, "detail-type": "Object Deleted" };
    const result = validateS3Event(event);
    expect(result.valid).toBe(false);
  });

  test("detail.bucket.name が欠けているとエラー", () => {
    const event = {
      ...validS3Event,
      detail: { ...validS3Event.detail, bucket: {} },
    };
    const result = validateS3Event(event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("bucket field: name"))).toBe(true);
  });

  test("detail.object.size が負数はエラー", () => {
    const event = {
      ...validS3Event,
      detail: { ...validS3Event.detail, object: { key: "logs/app.log", size: -1 } },
    };
    const result = validateS3Event(event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("size"))).toBe(true);
  });

  test("detail.reason が欠けているとエラー", () => {
    const { reason: _, ...detailWithoutReason } = validS3Event.detail;
    const event = { ...validS3Event, detail: detailWithoutReason };
    const result = validateS3Event(event);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required detail field: reason");
  });
});

// ── validateEvent（自動判定） ─────────────────────────────────────

describe("validateEvent", () => {
  test("S3 イベントを自動判定して検証", () => {
    const result = validateEvent(validS3Event);
    expect(result.type).toBe("s3");
    expect(result.valid).toBe(true);
  });

  test("スケジューライベントを自動判定して検証", () => {
    const result = validateEvent(validSchedulerEvent);
    expect(result.type).toBe("scheduler");
    expect(result.valid).toBe(true);
  });

  test("null はエラー", () => {
    const result = validateEvent(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Event must be a non-null object");
  });

  test("文字列はエラー", () => {
    const result = validateEvent("not-an-object");
    expect(result.valid).toBe(false);
  });

  test("未知のイベントタイプは type: unknown", () => {
    const event = { ...validSchedulerEvent, source: "custom.app", "detail-type": "Custom" };
    const result = validateEvent(event);
    expect(result.type).toBe("unknown");
  });
});
