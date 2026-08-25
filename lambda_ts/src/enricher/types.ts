/**
 * Pattern C: EventBridge Pipes エンリッチメント Lambda - 型定義
 *
 * SQS メッセージの入力型・優先度ユニオン型・エンリッチ済み出力型を定義する。
 */

// ── 入力型 ───────────────────────────────────────────────────────────

export interface EnricherInput {
  key?: string;
  size?: number | string;
  [key: string]: unknown;
}

// ── 優先度 ───────────────────────────────────────────────────────────

export type Priority = 'high' | 'normal';

// ── 出力型 ───────────────────────────────────────────────────────────

export interface EnricherOutput extends EnricherInput {
  file_type: string;
  priority: Priority;
  enriched_at: string;
}
