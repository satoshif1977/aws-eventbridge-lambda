/**
 * Pattern C: EventBridge Pipes エンリッチメント Lambda - ヘルパー関数
 *
 * ファイル種別判定・優先度判定・JST 時刻生成を index.ts から分離。
 */

import type { Priority } from './types';

// ── 定数 ──────────────────────────────────────────────────────────

/** ファイルサイズによる優先度判定しきい値（1MB） */
export const HIGH_PRIORITY_THRESHOLD_BYTES = 1_000_000;

/** 拡張子 → ファイル種別マッピング */
export const EXT_TO_TYPE: Record<string, string> = {
  csv: 'csv',
  json: 'json',
  xml: 'xml',
  txt: 'text',
  log: 'log',
  zip: 'archive',
  gz: 'archive',
};

// ── ヘルパー関数 ──────────────────────────────────────────────────

/**
 * S3 オブジェクトキーから拡張子を取得してファイル種別を返す。
 * 拡張子なし → "unknown"、未登録拡張子 → 拡張子をそのまま返す。
 */
export function detectFileType(key: string): string {
  if (!key.includes('.')) return 'unknown';
  const ext = key.split('.').pop()!.toLowerCase();
  return EXT_TO_TYPE[ext] ?? ext;
}

/**
 * ファイルサイズに基づいて処理優先度を判定する。
 * 1MB 以上 → "high"、未満 → "normal"
 */
export function detectPriority(size: number): Priority {
  return size >= HIGH_PRIORITY_THRESHOLD_BYTES ? 'high' : 'normal';
}

/**
 * JST（UTC+9）の現在時刻を ISO 8601 形式で返す。
 */
export function nowJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().replace('Z', '+09:00').slice(0, 19) + '+09:00';
}
