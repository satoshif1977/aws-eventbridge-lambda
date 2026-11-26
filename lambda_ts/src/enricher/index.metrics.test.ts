/**
 * index.ts と metrics.ts の結線テスト
 *
 * metrics.test.ts が「EMF の出力が正しいか」を見るのに対し、
 * こちらは「ハンドラーが何をどのタイミングで記録するか」を見る。
 *
 * メトリクスは本処理ではないため、壊れても戻り値は変わってはいけない。
 * その不変条件もここで押さえる。
 */

import { createHandler } from './index';
import { createLogger } from './logger';
import { createMetrics, createNoopMetrics, RESERVED_ROOT_KEY, type Metrics } from './metrics';
import type { EnricherInput } from './types';

// ── テスト用の足場 ────────────────────────────────────────────

/** ログを捨てるロガー。メトリクスだけを見たいとき用 */
const silentLogger = () => createLogger({ level: 'silent' });

interface Harness {
  metrics: Metrics;
  docs: () => Record<string, unknown>[];
  /** 最初の EMF 文書 */
  doc: () => Record<string, unknown>;
  /** 最初の EMF 文書のメトリクス定義名 */
  names: () => string[];
}

const harness = (): Harness => {
  const lines: string[] = [];
  let clock = 1_700_000_000_000;
  const metrics = createMetrics({
    namespace: 'TestEnricher',
    sink: (line) => lines.push(line),
    // timer が 0ms にならないよう、呼ばれるたびに進める
    now: () => {
      clock += 5;
      return clock;
    },
  });
  const docs = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return {
    metrics,
    docs,
    doc: () => docs()[0],
    names: () => {
      const aws = docs()[0][RESERVED_ROOT_KEY] as {
        CloudWatchMetrics: { Metrics: { Name: string }[] }[];
      };
      return aws.CloudWatchMetrics[0].Metrics.map((m) => m.Name);
    },
  };
};

const run = (h: Harness, event: EnricherInput | EnricherInput[]) =>
  createHandler(silentLogger(), h.metrics)(event);

// ── 記録される内容 ────────────────────────────────────────────

describe('handler / メトリクスの記録', () => {
  it('1 回の呼び出しで EMF が 1 行出る', () => {
    const h = harness();
    run(h, { key: 'data.csv', size: 100 });
    expect(h.docs()).toHaveLength(1);
  });

  it('EnrichSuccess が記録される', () => {
    const h = harness();
    run(h, { key: 'data.csv', size: 100 });
    expect(h.doc().EnrichSuccess).toBe(1);
  });

  it('PayloadSize に size が入る', () => {
    const h = harness();
    run(h, { key: 'data.csv', size: 4096 });
    expect(h.doc().PayloadSize).toBe(4096);
  });

  it('EnrichLatency が記録される', () => {
    const h = harness();
    run(h, { key: 'data.csv', size: 1 });
    expect(typeof h.doc().EnrichLatency).toBe('number');
  });

  it('EnrichLatency は負にならない', () => {
    const h = harness();
    run(h, { key: 'data.csv', size: 1 });
    expect(h.doc().EnrichLatency as number).toBeGreaterThanOrEqual(0);
  });

  it('key / fileType / priority がプロパティに載る', () => {
    const h = harness();
    run(h, { key: 'reports/big.zip', size: 2_000_000 });
    expect(h.doc().key).toBe('reports/big.zip');
    expect(h.doc().fileType).toBe('archive');
    expect(h.doc().priority).toBe('high');
  });

  it('key はディメンションにしない', () => {
    // S3 のオブジェクトキーは値の種類が際限なく増える。
    // ディメンションにすると課金対象のカスタムメトリクスが増え続ける。
    const h = harness();
    run(h, { key: 'a/b/c.csv', size: 1 });
    const aws = h.doc()[RESERVED_ROOT_KEY] as { CloudWatchMetrics: { Dimensions: string[][] }[] };
    expect(aws.CloudWatchMetrics[0].Dimensions).toEqual([[]]);
  });

  it('key / fileType / priority はメトリクス定義に含めない', () => {
    const h = harness();
    run(h, { key: 'a.csv', size: 1 });
    expect(h.names()).not.toContain('key');
    expect(h.names()).not.toContain('fileType');
    expect(h.names()).not.toContain('priority');
  });
});

// ── 異常系の記録 ──────────────────────────────────────────────

describe('handler / 異常系のメトリクス', () => {
  it('key が無ければ MissingKey が立つ', () => {
    const h = harness();
    run(h, { size: 100 });
    expect(h.doc().MissingKey).toBe(1);
  });

  it('key があれば MissingKey は立たない', () => {
    const h = harness();
    run(h, { key: 'a.csv', size: 100 });
    expect(h.doc().MissingKey).toBeUndefined();
  });

  it('size が数値にならない場合は InvalidPayloadSize が立つ', () => {
    // Number('abc') は NaN。metrics.ts は NaN を例外にするため入口で弾いている
    const h = harness();
    run(h, { key: 'a.csv', size: 'abc' });
    expect(h.doc().InvalidPayloadSize).toBe(1);
  });

  it('size が数値にならない場合は PayloadSize を出さない', () => {
    const h = harness();
    run(h, { key: 'a.csv', size: 'abc' });
    expect(h.doc().PayloadSize).toBeUndefined();
  });

  it('size が数値文字列なら PayloadSize に入る', () => {
    const h = harness();
    run(h, { key: 'a.csv', size: '2048' });
    expect(h.doc().PayloadSize).toBe(2048);
  });

  it('size 未指定は 0 として記録される', () => {
    const h = harness();
    run(h, { key: 'a.csv' });
    expect(h.doc().PayloadSize).toBe(0);
  });

  it('空配列を渡しても EMF は出る', () => {
    const h = harness();
    run(h, []);
    expect(h.doc().EnrichSuccess).toBe(1);
    expect(h.doc().MissingKey).toBe(1);
  });
});

// ── 本処理への影響 ────────────────────────────────────────────

describe('handler / メトリクスは本処理に影響しない', () => {
  const sample: EnricherInput = { key: 'big.zip', size: 2_000_000 };

  it('戻り値はメトリクスの有無で変わらない', () => {
    const h = harness();
    const withMetrics = run(h, sample);
    const withoutMetrics = createHandler(silentLogger(), createNoopMetrics())(sample);
    expect(withMetrics).toEqual(withoutMetrics);
  });

  it('メトリクスは戻り値にフィールドを足さない', () => {
    const h = harness();
    const out = run(h, { key: 'a.csv', size: 1 });
    expect(Object.keys(out).sort()).toEqual(
      ['enriched_at', 'file_type', 'key', 'priority', 'size'].sort(),
    );
  });

  it('入力の追加フィールドは保持される', () => {
    const h = harness();
    const out = run(h, { key: 'a.csv', size: 1, bucket: 'my-bucket' });
    expect(out.bucket).toBe('my-bucket');
  });

  it('連続呼び出しでも 1 回ごとに 1 行出る', () => {
    const h = harness();
    run(h, { key: 'a.csv', size: 1 });
    run(h, { key: 'b.csv', size: 2 });
    run(h, { key: 'c.csv', size: 3 });
    expect(h.docs()).toHaveLength(3);
  });

  it('連続呼び出しで値が混ざらない', () => {
    const h = harness();
    run(h, { key: 'a.csv', size: 1 });
    run(h, { key: 'b.csv', size: 2 });
    expect(h.docs()[0].PayloadSize).toBe(1);
    expect(h.docs()[1].PayloadSize).toBe(2);
    expect(h.docs()[0].key).toBe('a.csv');
    expect(h.docs()[1].key).toBe('b.csv');
  });
});
