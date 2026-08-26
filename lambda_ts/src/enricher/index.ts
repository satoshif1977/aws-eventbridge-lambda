/**
 * Pattern C: EventBridge Pipes エンリッチメント Lambda（TypeScript 版）
 *
 * SQS メッセージを受け取り、ファイルタイプと優先度を付与して返す。
 * Python 版（lambda_src/enricher/index.py）と同ロジックの TypeScript 並置実装。
 *
 * 3言語比較:
 *   Python: dict 操作・スプレッド演算子相当は {**body, ...}
 *   Go    : 構造体で型安全・コールドスタート最速
 *   TS    : 静的型付け + 型推論・Union 型で priority を明示
 */

// ── 型・ヘルパーを re-export（テストファイルが "./index" から import しているため）──

import type { EnricherInput, EnricherOutput } from './types';
export type { EnricherInput, Priority, EnricherOutput } from './types';
export { detectFileType, detectPriority, nowJST } from './helpers';

import { detectFileType, detectPriority, nowJST } from './helpers';

// ── Lambda ハンドラー ─────────────────────────────────────────────

/**
 * Pipes エンリッチメント: S3 ファイル情報にメタデータを付与する。
 *
 * @param event Pipes から渡された SQS メッセージ body（単体 or 配列）
 * @returns file_type / priority / enriched_at を付与したエンリッチ済みオブジェクト
 */
export const handler = (event: EnricherInput | EnricherInput[]): EnricherOutput => {
  // Pipes の input_template "<$.body>" により body が直接渡される
  const body: EnricherInput = Array.isArray(event)
    ? (event[0] ?? {})
    : event;

  const key = typeof body.key === 'string' ? body.key : '';
  const size = Number(body.size ?? 0);

  const enriched: EnricherOutput = {
    ...body,
    file_type: detectFileType(key),
    priority: detectPriority(size),
    enriched_at: nowJST(),
  };

  console.log(
    `エンリッチ完了: key=${key} file_type=${enriched.file_type} priority=${enriched.priority}`,
  );

  return enriched;
};
