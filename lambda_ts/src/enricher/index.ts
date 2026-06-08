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

// ── 型定義 ────────────────────────────────────────────────────────

export interface EnricherInput {
  key?: string;
  size?: number | string;
  [key: string]: unknown;
}

export type Priority = 'high' | 'normal';

export interface EnricherOutput extends EnricherInput {
  file_type: string;
  priority: Priority;
  enriched_at: string;
}

// ── 定数 ──────────────────────────────────────────────────────────

/** ファイルサイズによる優先度判定しきい値（1MB） */
const HIGH_PRIORITY_THRESHOLD_BYTES = 1_000_000;

/** 拡張子 → ファイル種別マッピング */
const EXT_TO_TYPE: Record<string, string> = {
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
