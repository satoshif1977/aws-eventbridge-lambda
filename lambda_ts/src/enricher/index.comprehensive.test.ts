/**
 * Pattern C: TypeScript enricher 網羅的テスト
 * 統合テスト・非破壊検証・固定時刻での正確な値検証を追加。
 */

import { detectFileType, detectPriority, nowJST, handler, EnricherInput } from './index';

// ── EXT_TO_TYPE 全マッピング一括検証 ─────────────────────────────────────────

describe('detectFileType / EXT_TO_TYPE 全マッピング一括検証', () => {
  const registeredExts: [string, string][] = [
    ['csv', 'csv'],
    ['json', 'json'],
    ['xml', 'xml'],
    ['txt', 'text'],
    ['log', 'log'],
    ['zip', 'archive'],
    ['gz', 'archive'],
  ];

  test.each(registeredExts)(
    '登録済み拡張子 .%s → "%s"',
    (ext, expected) => {
      expect(detectFileType(`file.${ext}`)).toBe(expected);
    },
  );

  test('登録済み7拡張子を全てカバーしている', () => {
    expect(registeredExts).toHaveLength(7);
  });

  test.each(registeredExts)(
    '大文字拡張子 .%s → "%s"（大文字小文字無視）',
    (ext, expected) => {
      expect(detectFileType(`file.${ext.toUpperCase()}`)).toBe(expected);
    },
  );
});

// ── detectFileType / 戻り値の型検証 ──────────────────────────────────────────

describe('detectFileType / 戻り値の一貫性', () => {
  test('常に string を返す', () => {
    const cases = ['file.csv', 'file', '', '.', 'a.b.c'];
    cases.forEach((key) => {
      expect(typeof detectFileType(key)).toBe('string');
    });
  });

  test('同じ入力に対して同じ結果を返す（冪等性）', () => {
    const key = 'path/to/data.json';
    const r1 = detectFileType(key);
    const r2 = detectFileType(key);
    expect(r1).toBe(r2);
  });
});

// ── detectPriority / 戻り値の型検証 ──────────────────────────────────────────

describe('detectPriority / 戻り値の一貫性', () => {
  test('常に "high" か "normal" のいずれかを返す', () => {
    const sizes = [0, 500000, 999999, 1000000, 1000001, 5000000];
    sizes.forEach((size) => {
      expect(['high', 'normal']).toContain(detectPriority(size));
    });
  });

  test('同じ入力に対して同じ結果を返す（冪等性）', () => {
    expect(detectPriority(500000)).toBe(detectPriority(500000));
    expect(detectPriority(2000000)).toBe(detectPriority(2000000));
  });
});

// ── nowJST / 時間帯境界テスト ────────────────────────────────────────────────

describe('nowJST / 時間帯境界', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('UTC 15:00 → JST 翌日 00:00（日付跨ぎ）', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-25T15:00:00Z'));
    expect(nowJST()).toBe('2026-08-26T00:00:00+09:00');
  });

  test('UTC 23:59:59 → JST 翌日 08:59:59', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-12-31T23:59:59Z'));
    expect(nowJST()).toBe('2027-01-01T08:59:59+09:00');
  });

  test('UTC 00:00:00 → JST 09:00:00', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-15T00:00:00Z'));
    expect(nowJST()).toBe('2026-06-15T09:00:00+09:00');
  });
});

// ── handler / 入力非破壊検証 ─────────────────────────────────────────────────

describe('handler / 入力非破壊検証', () => {
  test('単体オブジェクトの入力が変更されないこと', () => {
    const input: EnricherInput = { key: 'data.csv', size: 500 };
    const originalKeys = Object.keys(input).sort();
    handler(input);
    expect(Object.keys(input).sort()).toEqual(originalKeys);
  });

  test('配列入力の要素が変更されないこと', () => {
    const item: EnricherInput = { key: 'batch.xml', size: 300 };
    const arr = [item];
    handler(arr);
    expect(Object.keys(item).sort()).toEqual(['key', 'size']);
  });
});

// ── handler / 固定時刻での統合テスト ─────────────────────────────────────────

describe('handler / 固定時刻統合テスト', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('全フィールドが正確に設定される（CSV + normal）', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-25T03:30:00Z'));

    const result = handler({
      key: 'uploads/report.csv',
      size: 500,
      bucket: 'my-bucket',
    });

    expect(result.key).toBe('uploads/report.csv');
    expect(result.size).toBe(500);
    expect(result.bucket).toBe('my-bucket');
    expect(result.file_type).toBe('csv');
    expect(result.priority).toBe('normal');
    expect(result.enriched_at).toBe('2026-08-25T12:30:00+09:00');
  });

  test('全フィールドが正確に設定される（ZIP + high）', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const result = handler({
      key: 'archives/backup.zip',
      size: 5_000_000,
    });

    expect(result.file_type).toBe('archive');
    expect(result.priority).toBe('high');
    expect(result.enriched_at).toBe('2026-01-01T09:00:00+09:00');
  });

  test('配列入力 + 固定時刻', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-15T12:00:00Z'));

    const result = handler([{ key: 'logs/app.log', size: 100 }]);

    expect(result.file_type).toBe('log');
    expect(result.priority).toBe('normal');
    expect(result.enriched_at).toBe('2026-06-15T21:00:00+09:00');
  });

  test('空オブジェクト + 固定時刻', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-01T00:00:00Z'));

    const result = handler({});

    expect(result.file_type).toBe('unknown');
    expect(result.priority).toBe('normal');
    expect(result.enriched_at).toBe('2026-03-01T09:00:00+09:00');
  });
});

// ── handler / console.log 正確なフォーマット検証 ─────────────────────────────

describe('handler / console.log 正確なフォーマット', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test.each([
    [
      { key: 'data.csv', size: 100 },
      'エンリッチ完了: key=data.csv file_type=csv priority=normal',
    ],
    [
      { key: 'big.zip', size: 2_000_000 },
      'エンリッチ完了: key=big.zip file_type=archive priority=high',
    ],
    [
      { size: 100 },
      'エンリッチ完了: key= file_type=unknown priority=normal',
    ],
    [
      { key: 'report.json', size: 1_000_000 },
      'エンリッチ完了: key=report.json file_type=json priority=high',
    ],
  ] as [EnricherInput, string][])(
    'input=%j → log="%s"',
    (input, expectedLog) => {
      handler(input);
      expect(consoleSpy).toHaveBeenCalledWith(expectedLog);
    },
  );
});

// ── handler / 戻り値のスプレッド順序検証 ─────────────────────────────────────

describe('handler / スプレッド上書き検証', () => {
  test('入力に file_type があっても detectFileType の結果で上書きされる', () => {
    const result = handler({ key: 'data.json', size: 100, file_type: 'wrong' });
    expect(result.file_type).toBe('json');
  });

  test('入力に priority があっても detectPriority の結果で上書きされる', () => {
    const result = handler({
      key: 'data.csv',
      size: 2_000_000,
      priority: 'normal' as never,
    });
    expect(result.priority).toBe('high');
  });

  test('入力に enriched_at があっても nowJST の結果で上書きされる', () => {
    const result = handler({
      key: 'data.csv',
      size: 100,
      enriched_at: 'old-timestamp',
    });
    expect(result.enriched_at).not.toBe('old-timestamp');
    expect(result.enriched_at).toMatch(/\+09:00$/);
  });
});

// ── detectFileType / パスセパレータ検証 ──────────────────────────────────────

describe('detectFileType / パスセパレータ', () => {
  test('バックスラッシュを含むパスでも拡張子を正しく検出する', () => {
    // split('.') はパスセパレータに影響されない
    expect(detectFileType('path\\to\\file.csv')).toBe('csv');
  });

  test('深いディレクトリパスでも拡張子を正しく検出する', () => {
    expect(detectFileType('a/b/c/d/e/f/g/h/file.xml')).toBe('xml');
  });

  test('URLエンコード風の文字列でも拡張子を正しく検出する', () => {
    expect(detectFileType('path%20to/file%20name.json')).toBe('json');
  });
});
