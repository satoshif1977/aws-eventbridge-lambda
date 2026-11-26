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
 *
 * メトリクスは同梱の metrics.ts（CloudWatch EMF）に出す。
 * Pipes の途中に挟まる関数のため、呼び出し元のメトリクスには「Pipes の失敗」
 * としか出ない。処理件数・所要時間・ファイルタイプを自前で出しておく。
 */

// ── 型・ヘルパーを re-export（テストファイルが "./index" から import しているため）──

import type { EnricherInput, EnricherOutput } from './types';
export type { EnricherInput, Priority, EnricherOutput } from './types';
export { detectFileType, detectPriority, nowJST } from './helpers';

import { detectFileType, detectPriority, nowJST } from './helpers';
import { createLoggerFromEnv, type Logger } from './logger';
import { createMetricsFromEnv, type Metrics } from './metrics';

// ── Lambda ハンドラー ─────────────────────────────────────────────

/**
 * ロガー・メトリクスを差し替えられる形でハンドラーを組み立てる。
 *
 * Lambda は handler(event, context, callback) の順で引数を渡すため、
 * ロガーを第2引数にすると context を受け取ってしまう。
 * ファクトリにして渡す形なら、テストからだけ安全に差し替えられる。
 *
 * @param logger  省略時は LOG_LEVEL から組み立てる
 * @param metrics 省略時は METRICS_NAMESPACE / STAGE から組み立てる
 */
export const createHandler =
  (logger: Logger = createLoggerFromEnv(), metrics: Metrics = createMetricsFromEnv()) =>
  (event: EnricherInput | EnricherInput[]): EnricherOutput => {
    const stopTimer = metrics.timer('EnrichLatency');

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

    metrics.count('EnrichSuccess');
    // key は S3 のオブジェクトキーで値の種類が際限なく増える。
    // ディメンションにすると課金対象のカスタムメトリクスが増え続けるため
    // プロパティとして載せる。file_type / priority は取りうる値が限られるので
    // ディメンションにしてよいが、ここでは Pipes 単位の集計で足りるため揃える。
    metrics.setProperty('key', key);
    metrics.setProperty('fileType', enriched.file_type);
    metrics.setProperty('priority', enriched.priority);
    // size は入力が文字列や欠損のこともあり NaN になりうる。
    // metrics.ts は NaN を例外にするため、入口で弾いておく。
    if (Number.isFinite(size)) {
      metrics.putMetric('PayloadSize', size, { unit: 'Bytes' });
    } else {
      metrics.count('InvalidPayloadSize');
    }
    if (key === '') metrics.count('MissingKey');

    stopTimer();
    metrics.flush();

    return enriched;
  };

/**
 * Pipes エンリッチメント: S3 ファイル情報にメタデータを付与する。
 *
 * @param event Pipes から渡された SQS メッセージ body（単体 or 配列）
 * @returns file_type / priority / enriched_at を付与したエンリッチ済みオブジェクト
 */
export const handler = createHandler();
