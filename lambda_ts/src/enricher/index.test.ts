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

// ── detectFileType / 境界・特殊ケース ─────────────────────────────

describe('detectFileType / 境界・特殊ケース', () => {
  it.each([
    ['', 'unknown'],                         // 空文字列
    ['.', ''],                               // ドットのみ → pop() は ''
    ['..', ''],                              // ドット2つ
    ['.hidden', 'hidden'],                   // ドットファイル → 拡張子として解釈
    ['.gitignore', 'gitignore'],             // ドットファイル（一般的）
    ['path/to/.env', 'env'],                 // ディレクトリ内ドットファイル
    ['a.b.c.d.csv', 'csv'],                  // 多重ドット
    ['日本語/テスト.json', 'json'],            // 日本語ディレクトリ + 拡張子
    ['spaces in name.txt', 'text'],          // スペース含むファイル名
    ['UPPER.CSV', 'csv'],                    // 全大文字パス
    ['MiXeD.JsOn', 'json'],                 // 混在ケース
    ['file.ZIP', 'archive'],                 // 大文字 ZIP → archive
    ['file.GZ', 'archive'],                  // 大文字 GZ → archive
    ['file.TXT', 'text'],                    // 大文字 TXT → text
  ])('detectFileType("%s") → "%s"', (key, expected) => {
    expect(detectFileType(key)).toBe(expected);
  });
});

// ── detectFileType / 未登録拡張子バリエーション ───────────────────

describe('detectFileType / 未登録拡張子', () => {
  it.each([
    ['image.png', 'png'],
    ['image.jpg', 'jpg'],
    ['image.jpeg', 'jpeg'],
    ['video.mp4', 'mp4'],
    ['doc.docx', 'docx'],
    ['sheet.xlsx', 'xlsx'],
    ['script.py', 'py'],
    ['code.ts', 'ts'],
    ['code.js', 'js'],
    ['binary.exe', 'exe'],
    ['archive.tar', 'tar'],
    ['data.parquet', 'parquet'],
    ['config.yaml', 'yaml'],
    ['config.yml', 'yml'],
    ['template.html', 'html'],
  ])('未登録拡張子 "%s" → "%s"（そのまま返す）', (key, expected) => {
    expect(detectFileType(key)).toBe(expected);
  });
});

// ── detectPriority / 特殊数値 ────────────────────────────────────

describe('detectPriority / 特殊数値', () => {
  it('Infinity は high', () => {
    expect(detectPriority(Infinity)).toBe('high');
  });

  it('NaN は normal（NaN < threshold → false → normal）', () => {
    expect(detectPriority(NaN)).toBe('normal');
  });

  it('小数 999999.9 は normal', () => {
    expect(detectPriority(999_999.9)).toBe('normal');
  });

  it('小数 1000000.1 は high', () => {
    expect(detectPriority(1_000_000.1)).toBe('high');
  });

  it('-Infinity は normal', () => {
    expect(detectPriority(-Infinity)).toBe('normal');
  });

  it('非常に大きい整数は high', () => {
    expect(detectPriority(1e15)).toBe('high');
  });
});

// ── nowJST / Date モック ─────────────────────────────────────────

describe('nowJST / Date モック', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('固定時刻での JST 変換が正しい', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const result = nowJST();
    expect(result).toBe('2026-01-01T09:00:00+09:00');
    jest.useRealTimers();
  });

  it('連続呼び出しでフォーマットが一貫している', () => {
    const r1 = nowJST();
    const r2 = nowJST();
    expect(r1).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
    expect(r2).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  });
});

// ── handler / console.log スパイ ─────────────────────────────────

describe('handler / console.log 出力検証', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('エンリッチ完了ログが出力される', () => {
    handler({ key: 'data.csv', size: 100 });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('エンリッチ完了'),
    );
  });

  it('ログに key が含まれる', () => {
    handler({ key: 'reports/monthly.json', size: 500 });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('key=reports/monthly.json'),
    );
  });

  it('ログに file_type が含まれる', () => {
    handler({ key: 'data.xml', size: 100 });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('file_type=xml'),
    );
  });

  it('ログに priority が含まれる', () => {
    handler({ key: 'big.zip', size: 2_000_000 });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('priority=high'),
    );
  });

  it('key 未指定時のログに key= が含まれる', () => {
    handler({ size: 100 });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('key='),
    );
  });
});

// ── handler / 型強制・変換エッジケース ─────────────────────────────

describe('handler / 型強制・変換', () => {
  it('size が文字列 "0" のとき priority が normal', () => {
    const result = handler({ key: 'file.csv', size: '0' });
    expect(result.priority).toBe('normal');
  });

  it('size が文字列 "1000000" のとき priority が high', () => {
    const result = handler({ key: 'file.csv', size: '1000000' });
    expect(result.priority).toBe('high');
  });

  it('size が文字列 "abc" のとき NaN → normal', () => {
    const result = handler({ key: 'file.csv', size: 'abc' });
    expect(result.priority).toBe('normal');
  });

  it('key が数値型のとき file_type が unknown', () => {
    const result = handler({ key: 123 as unknown as string, size: 100 });
    expect(result.file_type).toBe('unknown');
  });

  it('空オブジェクトのとき file_type=unknown, priority=normal', () => {
    const result = handler({});
    expect(result.file_type).toBe('unknown');
    expect(result.priority).toBe('normal');
  });
});

// ── handler / 戻り値の構造検証 ────────────────────────────────────

describe('handler / 戻り値構造', () => {
  it('戻り値に file_type, priority, enriched_at の3フィールドが追加される', () => {
    const result = handler({ key: 'test.csv', size: 100 });
    expect(result).toHaveProperty('file_type');
    expect(result).toHaveProperty('priority');
    expect(result).toHaveProperty('enriched_at');
  });

  it('入力フィールドと出力フィールドを合わせた全キーが存在する', () => {
    const input = { key: 'x.log', size: 50, custom: 'value' };
    const result = handler(input);
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(['key', 'size', 'custom', 'file_type', 'priority', 'enriched_at']),
    );
  });

  it('enriched_at は文字列型', () => {
    const result = handler({ key: 'test.txt', size: 0 });
    expect(typeof result.enriched_at).toBe('string');
  });

  it('priority は "high" か "normal" のいずれか', () => {
    const r1 = handler({ key: 'a.csv', size: 0 });
    const r2 = handler({ key: 'b.csv', size: 2_000_000 });
    expect(['high', 'normal']).toContain(r1.priority);
    expect(['high', 'normal']).toContain(r2.priority);
  });
});

// ── handler / 配列の追加パターン ──────────────────────────────────

describe('handler / 配列の追加パターン', () => {
  it('配列に1要素のとき正しく処理される', () => {
    const result = handler([{ key: 'single.json', size: 500 }]);
    expect(result.file_type).toBe('json');
    expect(result.priority).toBe('normal');
  });

  it('配列に3要素以上あっても先頭だけ処理する', () => {
    const result = handler([
      { key: 'first.csv', size: 100 },
      { key: 'second.json', size: 200 },
      { key: 'third.xml', size: 300 },
    ]);
    expect(result.file_type).toBe('csv');
  });

  it('配列の先頭が空オブジェクトのとき defaults', () => {
    const result = handler([{}]);
    expect(result.file_type).toBe('unknown');
    expect(result.priority).toBe('normal');
  });

  it('配列要素に追加フィールドがあっても保持される', () => {
    const result = handler([{ key: 'data.log', size: 50, source: 'batch' }]);
    expect(result.source).toBe('batch');
  });
});
