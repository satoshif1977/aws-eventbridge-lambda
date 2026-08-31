/**
 * EventBridge Pipes エンリッチメント バリデーター
 *
 * S3 イベントペイロードの入力データを検証する純粋関数群。
 * AWS SDK に依存しないため単体テストが容易。
 *
 * 検証内容:
 *   - S3 オブジェクトキーのフォーマット・長さ・禁止パターン
 *   - ファイルサイズの範囲（0〜S3 上限 5TB）
 *   - 拡張子に基づく Content-Type 推定
 *   - エンリッチメント入出力の構造チェック
 *   - 優先度判定の妥当性
 */

import type { EnricherInput, EnricherOutput, Priority } from "./types";

// ── 型定義 ────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

// ── 定数 ─────────────────────────────────────────────────────

/** S3 オブジェクトキーの最大バイト長（UTF-8） */
export const MAX_S3_KEY_BYTES = 1024;

/** S3 オブジェクトの最大サイズ（5 TB） */
export const MAX_S3_OBJECT_SIZE = 5 * 1024 * 1024 * 1024 * 1024;

/** S3 キーで禁止する文字パターン（制御文字） */
export const FORBIDDEN_KEY_CHARS = /[\x00-\x1f\x7f]/;

/** パストラバーサルの危険なパターン */
export const PATH_TRAVERSAL_PATTERN = /(?:^|\/)\.\.\//;

/** 拡張子 → Content-Type マッピング */
export const EXT_TO_CONTENT_TYPE: Readonly<Record<string, string>> = {
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  txt: "text/plain",
  log: "text/plain",
  zip: "application/zip",
  gz: "application/gzip",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  html: "text/html",
  parquet: "application/x-parquet",
};

/** サポートするファイル拡張子（処理対象として認識する） */
export const SUPPORTED_EXTENSIONS = [
  "csv",
  "json",
  "xml",
  "txt",
  "log",
  "zip",
  "gz",
] as const;

/** 有効な Priority 値 */
export const VALID_PRIORITIES: readonly Priority[] = ["high", "normal"];

// ── S3 キーバリデーション ─────────────────────────────────────

/** S3 キーが空でないか */
export function isNonEmptyKey(key: string): boolean {
  return key.trim().length > 0;
}

/** S3 キーのバイト長が上限内か */
export function isWithinKeyByteLimit(key: string): boolean {
  return new TextEncoder().encode(key).length <= MAX_S3_KEY_BYTES;
}

/** S3 キーに禁止文字（制御文字）が含まれていないか */
export function hasNoForbiddenChars(key: string): boolean {
  return !FORBIDDEN_KEY_CHARS.test(key);
}

/** S3 キーにパストラバーサルが含まれていないか */
export function hasNoPathTraversal(key: string): boolean {
  return !PATH_TRAVERSAL_PATTERN.test(key);
}

/** S3 キーから拡張子を取得する（ドットなし小文字、拡張子なしは空文字） */
export function getExtension(key: string): string {
  const basename = key.split("/").pop() ?? "";
  if (!basename.includes(".")) return "";
  return basename.split(".").pop()!.toLowerCase();
}

/** 拡張子がサポート対象か */
export function isSupportedExtension(ext: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

/** 拡張子から Content-Type を推定する（不明な拡張子は application/octet-stream） */
export function inferContentType(key: string): string {
  const ext = getExtension(key);
  if (!ext) return "application/octet-stream";
  return EXT_TO_CONTENT_TYPE[ext] ?? "application/octet-stream";
}

/** S3 キーを検証する */
export function validateS3Key(key: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isNonEmptyKey(key)) {
    errors.push({
      field: "key",
      message: "S3 オブジェクトキーが空です",
      severity: "error",
    });
    return errors;
  }

  if (!isWithinKeyByteLimit(key)) {
    errors.push({
      field: "key",
      message: `S3 キーが上限 ${MAX_S3_KEY_BYTES} バイトを超えています`,
      severity: "error",
    });
  }

  if (!hasNoForbiddenChars(key)) {
    errors.push({
      field: "key",
      message: "S3 キーに制御文字が含まれています",
      severity: "error",
    });
  }

  if (!hasNoPathTraversal(key)) {
    errors.push({
      field: "key",
      message: "S3 キーにパストラバーサル（../）が含まれています",
      severity: "error",
    });
  }

  if (key.startsWith("/")) {
    errors.push({
      field: "key",
      message: "S3 キーは / で始めないことを推奨します",
      severity: "warning",
    });
  }

  if (key.endsWith("/")) {
    errors.push({
      field: "key",
      message:
        "S3 キーが / で終わっています（フォルダマーカーの可能性があります）",
      severity: "warning",
    });
  }

  const ext = getExtension(key);
  if (ext && !isSupportedExtension(ext)) {
    errors.push({
      field: "key",
      message: `未サポートの拡張子: "${ext}"。file_type はそのまま "${ext}" が設定されます`,
      severity: "warning",
    });
  }

  return errors;
}

// ── ファイルサイズバリデーション ──────────────────────────────

/** ファイルサイズが有効な範囲内か */
export function isValidFileSize(size: number): boolean {
  return Number.isFinite(size) && size >= 0 && size <= MAX_S3_OBJECT_SIZE;
}

/** ファイルサイズを検証する */
export function validateFileSize(size: number): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!Number.isFinite(size)) {
    errors.push({
      field: "size",
      message: "size が有効な数値ではありません",
      severity: "error",
    });
    return errors;
  }

  if (size < 0) {
    errors.push({
      field: "size",
      message: `size が負の値です: ${size}`,
      severity: "error",
    });
    return errors;
  }

  if (size > MAX_S3_OBJECT_SIZE) {
    errors.push({
      field: "size",
      message: `size が S3 上限（5TB）を超えています: ${size}`,
      severity: "error",
    });
  }

  if (size === 0) {
    errors.push({
      field: "size",
      message: "size が 0 です（空ファイル）。処理がスキップされる可能性があります",
      severity: "warning",
    });
  }

  return errors;
}

// ── エンリッチメント入力バリデーション ────────────────────────

/** エンリッチメント入力を検証する */
export function validateEnricherInput(
  input: EnricherInput
): ValidationError[] {
  const errors: ValidationError[] = [];

  // key チェック
  if (input.key === undefined || input.key === null) {
    errors.push({
      field: "key",
      message: "key フィールドが未定義です。空文字として処理されます",
      severity: "warning",
    });
  } else if (typeof input.key === "string") {
    errors.push(...validateS3Key(input.key));
  } else {
    errors.push({
      field: "key",
      message: `key は文字列である必要があります（型: ${typeof input.key}）`,
      severity: "error",
    });
  }

  // size チェック
  if (input.size === undefined || input.size === null) {
    errors.push({
      field: "size",
      message: "size フィールドが未定義です。0 として処理されます",
      severity: "warning",
    });
  } else {
    const numSize = Number(input.size);
    if (isNaN(numSize)) {
      errors.push({
        field: "size",
        message: `size を数値に変換できません: "${input.size}"`,
        severity: "error",
      });
    } else {
      errors.push(...validateFileSize(numSize));
    }
  }

  return errors;
}

// ── エンリッチメント出力バリデーション ────────────────────────

/** Priority が有効な値か */
export function isValidPriority(value: string): boolean {
  return (VALID_PRIORITIES as readonly string[]).includes(value);
}

/** エンリッチメント出力を検証する */
export function validateEnricherOutput(
  output: EnricherOutput
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!output.file_type) {
    errors.push({
      field: "file_type",
      message: "file_type が空です",
      severity: "error",
    });
  }

  if (!isValidPriority(output.priority)) {
    errors.push({
      field: "priority",
      message: `無効な priority: "${output.priority}"。有効値: ${VALID_PRIORITIES.join(", ")}`,
      severity: "error",
    });
  }

  if (!output.enriched_at) {
    errors.push({
      field: "enriched_at",
      message: "enriched_at が空です",
      severity: "error",
    });
  }

  return errors;
}

// ── 入出力整合性チェック ──────────────────────────────────────

/** 入力と出力の整合性を検証する */
export function validateInputOutputConsistency(
  input: EnricherInput,
  output: EnricherOutput
): ValidationError[] {
  const errors: ValidationError[] = [];

  // 入力 key が保持されているか
  if (input.key !== undefined && output.key !== input.key) {
    errors.push({
      field: "key",
      message: "出力の key が入力と一致しません",
      severity: "error",
    });
  }

  // size が保持されているか
  const inputSize = Number(input.size ?? 0);
  const outputSize = Number(output.size ?? 0);
  if (input.size !== undefined && inputSize !== outputSize) {
    errors.push({
      field: "size",
      message: "出力の size が入力と一致しません",
      severity: "error",
    });
  }

  return errors;
}

// ── ユーティリティ ────────────────────────────────────────────

/** エラーの有無を判定する（warning は含まない） */
export function hasErrors(errors: ValidationError[]): boolean {
  return errors.some((e) => e.severity === "error");
}

/** エラーをフォーマットする */
export function formatErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return "すべてのチェックが通過しました";
  return errors
    .map((e) => `[${e.severity.toUpperCase()}] ${e.field}: ${e.message}`)
    .join("\n");
}
