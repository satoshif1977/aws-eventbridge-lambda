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
 *
 * ログは同梱の logger.ts（構造化・機密情報マスキング付き）を通す。
 * console.log の文字列連結では Logs Insights から項目を取り出せないため。
 */

// ── 型・ヘルパーを re-export（テストファイルが "./index" から import しているため）──

import type { EnricherInput, EnricherOutput } from './types';
export type { EnricherInput, Priority, EnricherOutput } from './types';
export { detectFileType, detectPriority, nowJST } from './helpers';

import { detectFileType, detectPriority, nowJST } from './helpers';
import { createLoggerFromEnv, type Logger } from './logger';

// ── Lambda ハンドラー ─────────────────────────────────────────────

/**
 * ロガーを差し替えられる形でハンドラーを組み立てる。
 *
 * Lambda は handler(event, context, callback) の順で引数を渡すため、
 * ロガーを第2引数にすると context を受け取ってしまう。
 * ファクトリにして渡す形なら、テストからだけ安全に差し替えられる。
 *
 * @param logger 省略時は LOG_LEVEL から組み立てる
 */
export const createHandler =
  (logger: Logger = createLoggerFromEnv()) =>
  (event: EnricherInput | EnricherInput[]): EnricherOutput => {
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

    logger.info('エンリッチ完了', {
      key,
      size,
      file_type: enriched.file_type,
      priority: enriched.priority,
    });

    return enriched;
  };

/**
 * Pipes エンリッチメント: S3 ファイル情報にメタデータを付与する。
 *
 * @param event Pipes から渡された SQS メッセージ body（単体 or 配列）
 * @returns file_type / priority / enriched_at を付与したエンリッチ済みオブジェクト
 */
export const handler = createHandler();
