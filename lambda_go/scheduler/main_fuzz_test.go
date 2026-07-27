package main

import (
	"strings"
	"testing"
	"time"
)

// FuzzGenerateReportKeyFormat は generateReportKey が任意の time.Time で
// 常に "reports/YYYY-MM-DD/daily-report.json" 形式を返すことを検証する。
// 不変条件: S3 キーの形式はどの日付でも一貫している。
func FuzzGenerateReportKeyFormat(f *testing.F) {
	jst := time.FixedZone("JST", 9*60*60)

	// シードコーパス: Unix タイムスタンプ（秒）で時刻を指定
	f.Add(int64(0))                               // Unix epoch 1970-01-01
	f.Add(int64(1747051200))                      // 2026-05-13
	f.Add(int64(1893456000))                      // 2030-01-01
	f.Add(int64(1735689600))                      // 2026-01-01（JST 元旦）
	f.Add(int64(1893369600))                      // 2029-12-31

	f.Fuzz(func(t *testing.T, unixSec int64) {
		// 負の値や極端に大きな値はスキップ（time パッケージの有効範囲外）
		if unixSec < 0 || unixSec > 32503680000 { // 3000年まで
			t.Skip()
		}
		ts := time.Unix(unixSec, 0).In(jst)
		key := generateReportKey(ts)

		// 不変条件1: "reports/" で始まる
		if !strings.HasPrefix(key, "reports/") {
			t.Errorf("generateReportKey(%v)=%q: 'reports/' で始まっていない", ts, key)
		}

		// 不変条件2: "/daily-report.json" で終わる
		if !strings.HasSuffix(key, "/daily-report.json") {
			t.Errorf("generateReportKey(%v)=%q: '/daily-report.json' で終わっていない", ts, key)
		}

		// 不変条件3: "reports/YYYY-MM-DD/daily-report.json" の3パーツ構成
		parts := strings.Split(key, "/")
		if len(parts) != 3 {
			t.Errorf("generateReportKey(%v)=%q: パーツ数が3でない（実際: %d）", ts, key, len(parts))
		}

		// 不変条件4: 日付パーツが 10文字（YYYY-MM-DD）
		if len(parts) == 3 && len(parts[1]) != 10 {
			t.Errorf("generateReportKey(%v)=%q: 日付パーツが 10 文字でない（実際: %d）", ts, key, len(parts[1]))
		}
	})
}

// FuzzGenerateReportKeyIdempotent は同じ日付（異なる時刻）で同じキーが返ることを検証する。
// 不変条件: S3 キーは時刻でなく日付のみに依存する（冪等性）。
func FuzzGenerateReportKeyIdempotent(f *testing.F) {
	jst := time.FixedZone("JST", 9*60*60)

	f.Add(int64(0), int64(43200))   // 00:00 と 12:00
	f.Add(int64(86400), int64(0))   // 翌日
	f.Add(int64(3600), int64(7200)) // 1時間差

	f.Fuzz(func(t *testing.T, offsetA, offsetB int64) {
		if offsetA < 0 || offsetB < 0 || offsetA > 86399 || offsetB > 86399 {
			t.Skip()
		}
		// 同じ日の異なる時刻（2026-07-27 00:00 + offset）
		base := time.Date(2026, 7, 27, 0, 0, 0, 0, jst)
		tsA := base.Add(time.Duration(offsetA) * time.Second)
		tsB := base.Add(time.Duration(offsetB) * time.Second)

		keyA := generateReportKey(tsA)
		keyB := generateReportKey(tsB)

		// 不変条件: 同じ日の時刻違いは同じキーを返す
		if keyA != keyB {
			t.Errorf("同日（offset=%d と %d）でキーが異なる: %q vs %q", offsetA, offsetB, keyA, keyB)
		}
	})
}
