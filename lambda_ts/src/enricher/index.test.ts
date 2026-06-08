/**
 * Pattern C: TypeScript enricher ユニットテスト
 * AWS 接続不要・純粋関数のロジックを Jest で検証する。
 */

import { detectFileType, detectPriority, nowJST, handler } from './index';

// ── detectFileType ────────────────────────────────────────────────

describe('detectFileType', () => {
  it.each([
    ['reports/data.csv', 'csv'],
    ['uploads/config.json', 'json'],
    ['backup/export.xml', 'xml'],
    ['docs/readme.txt', 'text'],
    ['logs/app.log', 'log'],
    ['archives/data.zip', 'archive'],
    ['archives/data.gz', 'archive'],
    ['uploads/テスト.csv', 'csv'],       // 日本語ファイル名
    ['file', 'unknown'],                  // 拡張子なし
    ['path/to/file', 'unknown'],          // ディレクトリのみ
    ['data.XLSX', 'xlsx'],               // 未登録拡張子はそのまま（小文字化）
    ['data.PDF', 'pdf'],                 // 大文字拡張子 → 小文字化
  ])('detectFileType("%s") → "%s"', (key, expected) => {
    expect(detectFileType(key)).toBe(expected);
  });
});

// ── detectPriority ────────────────────────────────────────────────

describe('detectPriority', () => {
  it.each([
    [1_000_000, 'high'],    // ちょうど閾値 → high
    [1_000_001, 'high'],    // 閾値超え
    [999_999, 'normal'],    // 閾値未満
    [0, 'normal'],          // ゼロ
    [5_000_000, 'high'],    // 大きいサイズ
  ])('detectPriority(%d) → "%s"', (size, expected) => {
    expect(detectPriority(size)).toBe(expected);
  });
});

// ── nowJST ───────────────────────────────────────────────────────

describe('nowJST', () => {
  it('+09:00 サフィックスを含む', () => {
    expect(nowJST()).toMatch(/\+09:00$/);
  });

  it('ISO 8601 形式（YYYY-MM-DDTHH:mm:ss+09:00）', () => {
    expect(nowJST()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  });
});

// ── handler ──────────────────────────────────────────────────────

describe('handler - 単体オブジェクト', () => {
  it('file_type・priority・enriched_at が付与される', () => {
    const result = handler({ key: 'uploads/data.csv', size: 500 });

    expect(result.file_type).toBe('csv');
    expect(result.priority).toBe('normal');
    expect(result.enriched_at).toMatch(/\+09:00$/);
  });

  it('元フィールドが保持される', () => {
    const result = handler({ key: 'file.json', size: 200, bucket: 'my-bucket' });

    expect(result.key).toBe('file.json');
    expect(result.size).toBe(200);
    expect(result.bucket).toBe('my-bucket');
  });

  it('size が 1MB 以上なら priority が high', () => {
    const result = handler({ key: 'big.zip', size: 2_000_000 });
    expect(result.priority).toBe('high');
  });

  it('size が文字列でも数値に変換して判定する', () => {
    const result = handler({ key: 'data.log', size: '1500000' });
    expect(result.priority).toBe('high');
  });

  it('key がない場合は file_type が unknown', () => {
    const result = handler({ size: 100 });
    expect(result.file_type).toBe('unknown');
  });
});

describe('handler - 配列イベント', () => {
  it('配列の先頭要素を処理する', () => {
    const result = handler([{ key: 'batch.xml', size: 300 }]);

    expect(result.file_type).toBe('xml');
    expect(result.priority).toBe('normal');
  });

  it('空配列の場合はデフォルト値で処理する', () => {
    const result = handler([]);
    expect(result.file_type).toBe('unknown');
    expect(result.priority).toBe('normal');
  });
});
