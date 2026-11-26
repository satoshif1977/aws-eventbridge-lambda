/**
 * metrics.ts のユニットテスト
 *
 * EMF は「CloudWatch が黙って破棄する」失敗の仕方をする。
 * 壊れた文書を出しても例外は出ず、メトリクスが欠けるだけで気づけない。
 * そのため、出力そのものの形（_aws の構造・キーの位置・型）を検証する。
 *
 * sink と now を差し替えて、時刻にも console にも依存しない形で確かめる。
 */

import {
  createMetrics,
  createMetricsFromEnv,
  createNoopMetrics,
  consoleMetricsSink,
  DEFAULT_NAMESPACE,
  DEFAULT_UNIT,
  HIGH_RESOLUTION,
  MAX_DIMENSION_KEYS,
  MAX_DIMENSION_KEY_LENGTH,
  MAX_DIMENSION_VALUE_LENGTH,
  MAX_EVENT_BYTES,
  MAX_METRICS_PER_DOCUMENT,
  MAX_NAME_LENGTH,
  MAX_VALUES_PER_METRIC,
  METRIC_UNITS,
  RESERVED_ROOT_KEY,
  STANDARD_RESOLUTION,
  type Metrics,
  type MetricUnit,
} from './metrics';

// ── テスト用のシンク ──────────────────────────────────────────

interface Captured {
  metrics: Metrics;
  lines: string[];
  docs: () => Record<string, unknown>[];
  tick: (ms: number) => void;
}

/** 出力を配列に溜め、時刻を手で進められるレコーダを作る */
const capture = (
  options: Partial<Parameters<typeof createMetrics>[0]> = {},
): Captured => {
  const lines: string[] = [];
  let clock = 1_700_000_000_000;
  const metrics = createMetrics({
    namespace: 'TestNs',
    ...options,
    sink: (line) => lines.push(line),
    now: () => clock,
  });
  return {
    metrics,
    lines,
    docs: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
    tick: (ms) => {
      clock += ms;
    },
  };
};

/** EMF の _aws ブロックを取り出す */
const awsBlock = (doc: Record<string, unknown>) =>
  doc[RESERVED_ROOT_KEY] as {
    Timestamp: number;
    CloudWatchMetrics: {
      Namespace: string;
      Dimensions: string[][];
      Metrics: { Name: string; Unit?: string; StorageResolution?: number }[];
    }[];
  };

/** 先頭の MetricDirective を取り出す */
const directive = (doc: Record<string, unknown>) => awsBlock(doc).CloudWatchMetrics[0];

// ── 生成・名前空間 ────────────────────────────────────────────

describe('createMetrics / 名前空間', () => {
  it('namespace をそのまま保持する', () => {
    expect(createMetrics({ namespace: 'MyNs', sink: () => {} }).namespace).toBe('MyNs');
  });

  it('前後の空白は落とす', () => {
    expect(createMetrics({ namespace: '  MyNs  ', sink: () => {} }).namespace).toBe('MyNs');
  });

  it('空文字は例外', () => {
    expect(() => createMetrics({ namespace: '', sink: () => {} })).toThrow(TypeError);
  });

  it('空白だけも例外', () => {
    expect(() => createMetrics({ namespace: '   ', sink: () => {} })).toThrow(/名前空間が空/);
  });

  it('上限超えの長さは例外', () => {
    const tooLong = 'a'.repeat(MAX_NAME_LENGTH + 1);
    expect(() => createMetrics({ namespace: tooLong, sink: () => {} })).toThrow(RangeError);
  });

  it('上限ちょうどは通る', () => {
    const exact = 'a'.repeat(MAX_NAME_LENGTH);
    expect(() => createMetrics({ namespace: exact, sink: () => {} })).not.toThrow();
  });

  it('出力の Namespace に反映される', () => {
    const { metrics, docs } = capture({ namespace: 'Enricher' });
    metrics.count('X');
    metrics.flush();
    expect(directive(docs()[0]).Namespace).toBe('Enricher');
  });
});

// ── putMetric ─────────────────────────────────────────────────

describe('putMetric / 基本', () => {
  it('値がルート直下に載る', () => {
    const { metrics, docs } = capture();
    metrics.putMetric('Latency', 12);
    metrics.flush();
    expect(docs()[0].Latency).toBe(12);
  });

  it('メトリクス定義に名前が載る', () => {
    const { metrics, docs } = capture();
    metrics.putMetric('Latency', 12);
    metrics.flush();
    expect(directive(docs()[0]).Metrics).toEqual([{ Name: 'Latency' }]);
  });

  it('既定単位は出力に現れない', () => {
    const { metrics, docs } = capture();
    metrics.putMetric('X', 1, { unit: DEFAULT_UNIT });
    metrics.flush();
    expect(directive(docs()[0]).Metrics[0].Unit).toBeUndefined();
  });

  it('既定以外の単位は出力に現れる', () => {
    const { metrics, docs } = capture();
    metrics.putMetric('Size', 10, { unit: 'Bytes' });
    metrics.flush();
    expect(directive(docs()[0]).Metrics[0].Unit).toBe('Bytes');
  });

  it('同名を複数回入れると配列になる', () => {
    const { metrics, docs } = capture();
    metrics.putMetric('X', 1);
    metrics.putMetric('X', 2);
    metrics.putMetric('X', 3);
    metrics.flush();
    expect(docs()[0].X).toEqual([1, 2, 3]);
  });

  it('1 件のときは配列にしない', () => {
    const { metrics, docs } = capture();
    metrics.putMetric('X', 7);
    metrics.flush();
    expect(docs()[0].X).toBe(7);
  });

  it('同名を複数回入れても定義は 1 つ', () => {
    const { metrics, docs } = capture();
    metrics.putMetric('X', 1);
    metrics.putMetric('X', 2);
    metrics.flush();
    expect(directive(docs()[0]).Metrics).toHaveLength(1);
  });

  it('0 も負数も記録できる', () => {
    const { metrics, docs } = capture();
    metrics.putMetric('Zero', 0);
    metrics.putMetric('Neg', -5);
    metrics.flush();
    expect(docs()[0].Zero).toBe(0);
    expect(docs()[0].Neg).toBe(-5);
  });

  it('追加した順で定義が並ぶ', () => {
    const { metrics, docs } = capture();
    metrics.putMetric('C', 1);
    metrics.putMetric('A', 1);
    metrics.putMetric('B', 1);
    metrics.flush();
    expect(directive(docs()[0]).Metrics.map((m) => m.Name)).toEqual(['C', 'A', 'B']);
  });
});

describe('putMetric / 解像度', () => {
  it('既定は StorageResolution を出さない', () => {
    const { metrics, docs } = capture();
    metrics.putMetric('X', 1);
    metrics.flush();
    expect(directive(docs()[0]).Metrics[0].StorageResolution).toBeUndefined();
  });

  it('highResolution 指定で 1 が載る', () => {
    const { metrics, docs } = capture();
    metrics.putMetric('X', 1, { highResolution: true });
    metrics.flush();
    expect(directive(docs()[0]).Metrics[0].StorageResolution).toBe(HIGH_RESOLUTION);
  });

  it('標準解像度と高解像度の定数は異なる', () => {
    expect(STANDARD_RESOLUTION).not.toBe(HIGH_RESOLUTION);
  });
});

describe('putMetric / 入力検証', () => {
  it.each([
    ['空文字', ''],
    ['予約キー', RESERVED_ROOT_KEY],
  ])('メトリクス名が%sなら例外', (_label, name) => {
    const { metrics } = capture();
    expect(() => metrics.putMetric(name, 1)).toThrow(TypeError);
  });

  it('メトリクス名が長すぎると例外', () => {
    const { metrics } = capture();
    expect(() => metrics.putMetric('a'.repeat(MAX_NAME_LENGTH + 1), 1)).toThrow(RangeError);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('値が%sなら例外', (_label, value) => {
    // JSON.stringify がこれらを null にするため、黙って欠落させずに弾く
    const { metrics } = capture();
    expect(() => metrics.putMetric('X', value)).toThrow(TypeError);
  });

  it('値が数値でなければ例外', () => {
    const { metrics } = capture();
    expect(() => metrics.putMetric('X', '1' as unknown as number)).toThrow(TypeError);
  });

  it('未サポートの単位は例外', () => {
    const { metrics } = capture();
    expect(() => metrics.putMetric('X', 1, { unit: 'Furlongs' as MetricUnit })).toThrow(
      /サポートしていません/,
    );
  });

  it('単位は大文字小文字を区別する', () => {
    const { metrics } = capture();
    expect(() => metrics.putMetric('X', 1, { unit: 'count' as MetricUnit })).toThrow(TypeError);
  });

  it.each(METRIC_UNITS)('単位 %s は受け付ける', (unit) => {
    const { metrics } = capture();
    expect(() => metrics.putMetric('X', 1, { unit })).not.toThrow();
  });
});

// ── 糖衣 ──────────────────────────────────────────────────────

describe('count / duration / timer', () => {
  it('count は単位 Count になる', () => {
    const { metrics, docs } = capture();
    metrics.count('Items');
    metrics.flush();
    expect(directive(docs()[0]).Metrics[0].Unit).toBe('Count');
  });

  it('count の既定値は 1', () => {
    const { metrics, docs } = capture();
    metrics.count('Items');
    metrics.flush();
    expect(docs()[0].Items).toBe(1);
  });

  it('count は値を指定できる', () => {
    const { metrics, docs } = capture();
    metrics.count('Items', 5);
    metrics.flush();
    expect(docs()[0].Items).toBe(5);
  });

  it('count を 2 回呼ぶと配列で積み上がる', () => {
    const { metrics, docs } = capture();
    metrics.count('Items');
    metrics.count('Items');
    metrics.flush();
    expect(docs()[0].Items).toEqual([1, 1]);
  });

  it('duration は単位 Milliseconds になる', () => {
    const { metrics, docs } = capture();
    metrics.duration('Elapsed', 42);
    metrics.flush();
    expect(directive(docs()[0]).Metrics[0].Unit).toBe('Milliseconds');
    expect(docs()[0].Elapsed).toBe(42);
  });

  it('timer は停止までの経過時間を記録する', () => {
    const { metrics, docs, tick } = capture();
    const stop = metrics.timer('Latency');
    tick(250);
    stop();
    metrics.flush();
    expect(docs()[0].Latency).toBe(250);
  });

  it('timer は停止するまで何も記録しない', () => {
    const { metrics, lines } = capture();
    metrics.timer('Latency');
    metrics.flush();
    expect(lines).toHaveLength(0);
  });

  it('timer を 2 回停止すると 2 件記録される', () => {
    const { metrics, docs, tick } = capture();
    const stop = metrics.timer('Latency');
    tick(10);
    stop();
    tick(5);
    stop();
    metrics.flush();
    expect(docs()[0].Latency).toEqual([10, 15]);
  });
});

// ── ディメンション ────────────────────────────────────────────

describe('setDimensions', () => {
  it('ルート直下に値が載る', () => {
    const { metrics, docs } = capture();
    metrics.setDimensions({ Stage: 'prod' });
    metrics.count('X');
    metrics.flush();
    expect(docs()[0].Stage).toBe('prod');
  });

  it('Dimensions にキーが載る', () => {
    const { metrics, docs } = capture();
    metrics.setDimensions({ Stage: 'prod' });
    metrics.count('X');
    metrics.flush();
    expect(directive(docs()[0]).Dimensions).toEqual([['Stage']]);
  });

  it('コンストラクタ引数でも設定できる', () => {
    const { metrics, docs } = capture({ dimensions: { Stage: 'dev' } });
    metrics.count('X');
    metrics.flush();
    expect(docs()[0].Stage).toBe('dev');
  });

  it('キーはソートされて安定する', () => {
    const { metrics, docs } = capture();
    metrics.setDimensions({ Zone: 'a', Alpha: 'b', Mid: 'c' });
    metrics.count('X');
    metrics.flush();
    expect(directive(docs()[0]).Dimensions[0]).toEqual(['Alpha', 'Mid', 'Zone']);
  });

  it('ディメンションが無くても空の DimensionSet を 1 つ置く', () => {
    // キーごと省略すると CloudWatch 側でメトリクスが抽出されない
    const { metrics, docs } = capture();
    metrics.count('X');
    metrics.flush();
    expect(directive(docs()[0]).Dimensions).toEqual([[]]);
  });

  it('呼び直すと置き換わる（マージしない）', () => {
    const { metrics, docs } = capture();
    metrics.setDimensions({ A: '1' });
    metrics.setDimensions({ B: '2' });
    metrics.count('X');
    metrics.flush();
    expect(docs()[0].A).toBeUndefined();
    expect(docs()[0].B).toBe('2');
  });

  it('キー数が上限を超えると例外', () => {
    const { metrics } = capture();
    const tooMany: Record<string, string> = {};
    for (let i = 0; i <= MAX_DIMENSION_KEYS; i += 1) tooMany[`k${i}`] = 'v';
    expect(() => metrics.setDimensions(tooMany)).toThrow(RangeError);
  });

  it('上限ちょうどは通る', () => {
    const { metrics } = capture();
    const exact: Record<string, string> = {};
    for (let i = 0; i < MAX_DIMENSION_KEYS; i += 1) exact[`k${i}`] = 'v';
    expect(() => metrics.setDimensions(exact)).not.toThrow();
  });

  it('空のキーは例外', () => {
    const { metrics } = capture();
    expect(() => metrics.setDimensions({ '': 'v' })).toThrow(RangeError);
  });

  it('長すぎるキーは例外', () => {
    const { metrics } = capture();
    expect(() => metrics.setDimensions({ ['k'.repeat(MAX_DIMENSION_KEY_LENGTH + 1)]: 'v' })).toThrow(
      RangeError,
    );
  });

  it('空の値は例外', () => {
    const { metrics } = capture();
    expect(() => metrics.setDimensions({ Stage: '' })).toThrow(TypeError);
  });

  it('長すぎる値は例外', () => {
    const { metrics } = capture();
    expect(() =>
      metrics.setDimensions({ Stage: 'v'.repeat(MAX_DIMENSION_VALUE_LENGTH + 1) }),
    ).toThrow(RangeError);
  });

  it('予約キーは例外', () => {
    const { metrics } = capture();
    expect(() => metrics.setDimensions({ [RESERVED_ROOT_KEY]: 'v' })).toThrow(TypeError);
  });
});

// ── プロパティ ────────────────────────────────────────────────

describe('setProperty', () => {
  it('ルート直下に載る', () => {
    const { metrics, docs } = capture();
    metrics.setProperty('requestId', 'req-1');
    metrics.count('X');
    metrics.flush();
    expect(docs()[0].requestId).toBe('req-1');
  });

  it('メトリクス定義には載らない', () => {
    const { metrics, docs } = capture();
    metrics.setProperty('requestId', 'req-1');
    metrics.count('X');
    metrics.flush();
    expect(directive(docs()[0]).Metrics.map((m) => m.Name)).toEqual(['X']);
  });

  it('Dimensions にも載らない', () => {
    const { metrics, docs } = capture();
    metrics.setProperty('requestId', 'req-1');
    metrics.count('X');
    metrics.flush();
    expect(directive(docs()[0]).Dimensions).toEqual([[]]);
  });

  it('オブジェクトも載せられる', () => {
    const { metrics, docs } = capture();
    metrics.setProperty('detail', { a: 1 });
    metrics.count('X');
    metrics.flush();
    expect(docs()[0].detail).toEqual({ a: 1 });
  });

  it('空のキーは例外', () => {
    const { metrics } = capture();
    expect(() => metrics.setProperty('', 'v')).toThrow(TypeError);
  });

  it('予約キーは例外', () => {
    const { metrics } = capture();
    expect(() => metrics.setProperty(RESERVED_ROOT_KEY, 'v')).toThrow(TypeError);
  });
});

// ── 名前の衝突 ────────────────────────────────────────────────

describe('名前の衝突', () => {
  // EMF ではメトリクス・ディメンション・プロパティが同じルート直下に載るため、
  // 名前がぶつかると片方が黙って上書きされる。
  it('ディメンション名と同じメトリクス名は例外', () => {
    const { metrics } = capture({ dimensions: { Stage: 'dev' } });
    expect(() => metrics.putMetric('Stage', 1)).toThrow(/ディメンション名と衝突/);
  });

  it('プロパティ名と同じメトリクス名は例外', () => {
    const { metrics } = capture();
    metrics.setProperty('reqId', 'a');
    expect(() => metrics.putMetric('reqId', 1)).toThrow(/プロパティ名と衝突/);
  });

  it('メトリクス名と同じディメンション名は例外', () => {
    const { metrics } = capture();
    metrics.count('Items');
    expect(() => metrics.setDimensions({ Items: 'x' })).toThrow(/メトリクス名と衝突/);
  });

  it('メトリクス名と同じプロパティ名は例外', () => {
    const { metrics } = capture();
    metrics.count('Items');
    expect(() => metrics.setProperty('Items', 'x')).toThrow(/メトリクス名と衝突/);
  });

  it('ディメンション名と同じプロパティ名は例外', () => {
    const { metrics } = capture({ dimensions: { Stage: 'dev' } });
    expect(() => metrics.setProperty('Stage', 'x')).toThrow(/ディメンション名と衝突/);
  });
});

// ── flush ─────────────────────────────────────────────────────

describe('flush', () => {
  it('メトリクスが無ければ何も出さない', () => {
    const { metrics, lines } = capture();
    metrics.flush();
    expect(lines).toHaveLength(0);
  });

  it('プロパティだけでも何も出さない', () => {
    // プロパティはメトリクスではないので、単独では文書を作らない
    const { metrics, lines } = capture();
    metrics.setProperty('a', 1);
    metrics.flush();
    expect(lines).toHaveLength(0);
  });

  it('1 回の flush で 1 行だけ出す', () => {
    const { metrics, lines } = capture();
    metrics.count('X');
    metrics.flush();
    expect(lines).toHaveLength(1);
  });

  it('出力は改行を含まない 1 行', () => {
    const { metrics, lines } = capture();
    metrics.count('X');
    metrics.setProperty('note', 'line1\nline2');
    metrics.flush();
    expect(lines[0]).not.toContain('\n');
  });

  it('flush 後は定義がリセットされる', () => {
    const { metrics, lines } = capture();
    metrics.count('X');
    metrics.flush();
    metrics.flush();
    expect(lines).toHaveLength(1);
  });

  it('flush 後もディメンションは残る', () => {
    const { metrics, docs } = capture({ dimensions: { Stage: 'dev' } });
    metrics.count('X');
    metrics.flush();
    metrics.count('Y');
    metrics.flush();
    expect(docs()[1].Stage).toBe('dev');
  });

  it('Timestamp はエポックミリ秒', () => {
    const { metrics, docs } = capture();
    metrics.count('X');
    metrics.flush();
    expect(awsBlock(docs()[0]).Timestamp).toBe(1_700_000_000_000);
  });

  it('1 MB を超える文書は例外にする', () => {
    // CloudWatch は 1 ログイベント 1 MB が上限。超えた行は取り込まれないため、
    // 黙って捨てられるより例外にして気づけるようにする。
    const { metrics } = capture();
    metrics.count('X');
    metrics.setProperty('huge', 'a'.repeat(MAX_EVENT_BYTES));
    expect(() => metrics.flush()).toThrow(RangeError);
  });

  it('出力は JSON としてパースできる', () => {
    const { metrics, lines } = capture();
    metrics.count('X');
    metrics.setProperty('obj', { nested: [1, 2] });
    metrics.flush();
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });
});

describe('flush / 自動 flush', () => {
  it('同一メトリクスが上限に達すると自動で区切る', () => {
    const { metrics, lines } = capture();
    for (let i = 0; i < MAX_VALUES_PER_METRIC + 1; i += 1) metrics.count('X');
    // 上限到達は想定内。例外にせず 1 回 flush して続ける
    expect(lines).toHaveLength(1);
  });

  it('自動 flush 後の値は次の文書に入る', () => {
    const { metrics, docs } = capture();
    for (let i = 0; i < MAX_VALUES_PER_METRIC + 1; i += 1) metrics.count('X');
    metrics.flush();
    expect((docs()[0].X as number[]).length).toBe(MAX_VALUES_PER_METRIC);
    expect(docs()[1].X).toBe(1);
  });

  it('メトリクス種類が上限に達すると自動で区切る', () => {
    const { metrics, lines } = capture();
    for (let i = 0; i < MAX_METRICS_PER_DOCUMENT + 1; i += 1) metrics.count(`M${i}`);
    expect(lines).toHaveLength(1);
  });

  it('上限ちょうどでは区切らない', () => {
    const { metrics, lines } = capture();
    for (let i = 0; i < MAX_METRICS_PER_DOCUMENT; i += 1) metrics.count(`M${i}`);
    expect(lines).toHaveLength(0);
  });
});

// ── 既定のシンク ──────────────────────────────────────────────

describe('consoleMetricsSink', () => {
  it('console.log へ書く', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    consoleMetricsSink('{"a":1}');
    expect(spy).toHaveBeenCalledWith('{"a":1}');
    spy.mockRestore();
  });

  it('sink 未指定なら console.log が使われる', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const metrics = createMetrics({ namespace: 'Ns' });
    metrics.count('X');
    metrics.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

// ── createMetricsFromEnv ──────────────────────────────────────

describe('createMetricsFromEnv', () => {
  it('METRICS_NAMESPACE を使う', () => {
    expect(createMetricsFromEnv({ METRICS_NAMESPACE: 'FromEnv' }).namespace).toBe('FromEnv');
  });

  it('未設定なら既定の名前空間', () => {
    expect(createMetricsFromEnv({}).namespace).toBe(DEFAULT_NAMESPACE);
  });

  it('空文字なら既定の名前空間', () => {
    expect(createMetricsFromEnv({ METRICS_NAMESPACE: '   ' }).namespace).toBe(DEFAULT_NAMESPACE);
  });

  it('STAGE があれば Stage ディメンションが付く', () => {
    const lines: string[] = [];
    const metrics = createMetricsFromEnv({ STAGE: 'prod' }, { sink: (l) => lines.push(l) });
    metrics.count('X');
    metrics.flush();
    const doc = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(doc.Stage).toBe('prod');
  });

  it('STAGE が無ければディメンションを付けない', () => {
    // 未設定を "dev" で埋めると、本番の取りこぼしを dev の数字として読んでしまう
    const lines: string[] = [];
    const metrics = createMetricsFromEnv({}, { sink: (l) => lines.push(l) });
    metrics.count('X');
    metrics.flush();
    const doc = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(directive(doc).Dimensions).toEqual([[]]);
  });

  it('明示した namespace が環境変数より優先される', () => {
    expect(
      createMetricsFromEnv({ METRICS_NAMESPACE: 'FromEnv' }, { namespace: 'Explicit' }).namespace,
    ).toBe('Explicit');
  });

  it('引数を省略すると process.env を読む', () => {
    const saved = process.env.METRICS_NAMESPACE;
    process.env.METRICS_NAMESPACE = 'ViaProcessEnv';
    try {
      expect(createMetricsFromEnv().namespace).toBe('ViaProcessEnv');
    } finally {
      if (saved === undefined) delete process.env.METRICS_NAMESPACE;
      else process.env.METRICS_NAMESPACE = saved;
    }
  });
});

// ── createNoopMetrics ─────────────────────────────────────────

describe('createNoopMetrics', () => {
  it('何も出力しない', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const metrics = createNoopMetrics();
    metrics.count('X');
    metrics.duration('Y', 1);
    metrics.putMetric('Z', 1);
    metrics.flush();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('不正な入力でも例外にしない', () => {
    // 計測しない実装なので、検証も行わない
    const metrics = createNoopMetrics();
    expect(() => metrics.putMetric('', Number.NaN)).not.toThrow();
    expect(() => metrics.setDimensions({ '': '' })).not.toThrow();
    expect(() => metrics.setProperty('', 1)).not.toThrow();
  });

  it('timer は呼べる関数を返す', () => {
    const metrics = createNoopMetrics();
    expect(() => metrics.timer('X')()).not.toThrow();
  });

  it('既定の名前空間を持つ', () => {
    expect(createNoopMetrics().namespace).toBe(DEFAULT_NAMESPACE);
  });

  it('名前空間を指定できる', () => {
    expect(createNoopMetrics('Custom').namespace).toBe('Custom');
  });
});
