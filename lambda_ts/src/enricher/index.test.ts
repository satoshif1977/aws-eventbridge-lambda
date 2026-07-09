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

  it('配列の 2 番目以降の要素は無視される', () => {
    const result = handler([
      { key: 'first.csv', size: 100 },
      { key: 'second.json', size: 200 },
    ]);
    expect(result.file_type).toBe('csv');
  });
});

// ── detectFileType / 多重拡張子・追加ケース ────────────────────────

describe('detectFileType / 多重拡張子・追加', () => {
  it.each([
    ['archive.tar.gz', 'archive'],        // 最後の拡張子 .gz → archive
    ['report.2024.csv', 'csv'],           // 数字を含む名前でも最後の拡張子が優先
    ['CONFIG.JSON', 'json'],              // 大文字 .JSON → 小文字化して json
    ['logs/app.LOG', 'log'],              // 大文字 .LOG → log
    ['backup/2024.01.01.xml', 'xml'],     // 日付形式ファイル名でも最後の拡張子
  ])('detectFileType("%s") → "%s"', (key, expected) => {
    expect(detectFileType(key)).toBe(expected);
  });
});

// ── detectPriority / 境界値追加 ──────────────────────────────────

describe('detectPriority / 境界値追加', () => {
  it.each([
    [-1, 'normal'],                     // 負数は normal
    [Number.MAX_SAFE_INTEGER, 'high'],  // 最大整数は high
    [1_000_000 - 1, 'normal'],          // 閾値 -1 → normal
  ])('detectPriority(%d) → "%s"', (size, expected) => {
    expect(detectPriority(size)).toBe(expected);
  });
});

// ── nowJST / フォーマット詳細 ─────────────────────────────────────

describe('nowJST / フォーマット詳細', () => {
  it('戻り値の文字数が 25 文字', () => {
    expect(nowJST()).toHaveLength(25);
  });

  it('日付部分が有効な日付である', () => {
    const jst = nowJST();
    const datePart = jst.split('T')[0];
    expect(isNaN(new Date(datePart).getTime())).toBe(false);
  });
});

// ── handler / 追加エッジケース ────────────────────────────────────

describe('handler - 追加エッジケース', () => {
  it('size=0 のとき priority が normal', () => {
    const result = handler({ key: 'empty.csv', size: 0 });
    expect(result.priority).toBe('normal');
  });

  it('size が未指定のとき priority が normal', () => {
    const result = handler({ key: 'data.json' });
    expect(result.priority).toBe('normal');
  });

  it('多重拡張子の最後の拡張子が file_type になる', () => {
    const result = handler({ key: 'backup.tar.gz', size: 100 });
    expect(result.file_type).toBe('archive');
  });

  it('既存の file_type フィールドは新しい値で上書きされる', () => {
    const result = handler({ key: 'data.csv', size: 100, file_type: 'old-type' });
    expect(result.file_type).toBe('csv');
  });

  it('enriched_at の文字数が 25 である', () => {
    const result = handler({ key: 'test.log', size: 0 });
    expect(result.enriched_at).toHaveLength(25);
  });

  it('複数の追加フィールドが全て保持される', () => {
    const result = handler({
      key: 'x.txt',
      size: 50,
      bucket: 'my-bucket',
      region: 'ap-northeast-1',
      userId: 'u123',
    });
    expect(result.bucket).toBe('my-bucket');
    expect(result.region).toBe('ap-northeast-1');
    expect(result.userId).toBe('u123');
  });

  it('key が存在しない場合 file_type が unknown で priority が normal', () => {
    const result = handler({ size: 500 });
    expect(result.file_type).toBe('unknown');
    expect(result.priority).toBe('normal');
  });
});
