// wiring_test.go: awslog と awsretry の結線を検証する。
//
// ロガーもリトライ実行器も「置いてあるだけ」で呼ばれていない状態に
// 戻らないよう、本番の組み立て関数そのものをテストする。
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aws/smithy-go"
	"github.com/satoshif1977/aws-eventbridge-lambda/internal/awslog"
)

// decodeLines はバッファ内の 1 行 JSON をすべて復号する。
func decodeLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("ログ行の解析に失敗しました: %v\n%s", err, line)
		}
		out = append(out, rec)
	}
	return out
}

// ── リトライフックの結線 ──────────────────────────────────────

func TestNewRetrierはOnRetryにawslogを挿している(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := awslog.New(awslog.Options{Level: awslog.LevelDebug, Writer: buf})

	r := newRetrier(logger)
	if r.OnRetry == nil {
		t.Fatal("OnRetry が nil です。awslog.RetryHook が結線されていません")
	}

	r.OnRetry(2, 150*time.Millisecond, errors.New("throttled"))

	recs := decodeLines(t, buf)
	if len(recs) != 1 {
		t.Fatalf("ログ件数 = %d, want 1", len(recs))
	}
	rec := recs[0]
	if rec["level"] != "warn" {
		t.Errorf("level = %v, want warn（リトライは頻発したら異常なので warn）", rec["level"])
	}
	if rec["operation"] != "S3" {
		t.Errorf("operation = %v, want S3", rec["operation"])
	}
	if rec["attempt"] != float64(2) {
		t.Errorf("attempt = %v, want 2", rec["attempt"])
	}
	if rec["delayMs"] != float64(150) {
		t.Errorf("delayMs = %v, want 150", rec["delayMs"])
	}
}

func TestNewRetrierのフックはリトライ実行時に呼ばれる(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := awslog.New(awslog.Options{Level: awslog.LevelDebug, Writer: buf})

	r := newRetrier(logger)
	// 実待機をゼロにする。Sleep を差し替えられる設計を利用している。
	r.Sleep = func(context.Context, time.Duration) error { return nil }
	r.Rand = func() float64 { return 0.5 }

	attempts := 0
	err := r.Do(context.Background(), "PutObject", func(context.Context) error {
		attempts++
		if attempts < 3 {
			return retryableAPIError()
		}
		return nil
	})
	if err != nil {
		t.Fatalf("最終的には成功するはずです: %v", err)
	}
	if attempts != 3 {
		t.Fatalf("試行回数 = %d, want 3", attempts)
	}

	recs := decodeLines(t, buf)
	if len(recs) != 2 {
		t.Fatalf("リトライログ件数 = %d, want 2（3 回目で成功するため）", len(recs))
	}
	for i, rec := range recs {
		if rec["message"] != "AWS API 呼び出しをリトライします" {
			t.Errorf("recs[%d].message = %v", i, rec["message"])
		}
	}
}

// retryableAPIError は awsretry がリトライ対象と判定する AWS API エラーを返す。
// 既存の retry_test.go と同じ組み立て方に揃えている。
func retryableAPIError() error {
	return &smithy.GenericAPIError{
		Code:    "ThrottlingException",
		Message: "rate exceeded",
		Fault:   smithy.FaultClient,
	}
}

// ── パッケージ変数の結線 ──────────────────────────────────────

func Testパッケージのloggerとretrierがnilでない(t *testing.T) {
	if logger == nil {
		t.Fatal("logger が nil です")
	}
	if retrier.OnRetry == nil {
		t.Fatal("retrier.OnRetry が nil です。本番コードで結線されていません")
	}
}

// ── 機密値のマスキング ────────────────────────────────────────

func Testロガーは機密キーをマスキングする(t *testing.T) {
	buf := &bytes.Buffer{}
	l := awslog.New(awslog.Options{Level: awslog.LevelDebug, Writer: buf})

	l.Info("テスト", "password", "p@ssw0rd", "bucket", "my-bucket")

	recs := decodeLines(t, buf)
	if len(recs) != 1 {
		t.Fatalf("ログ件数 = %d, want 1", len(recs))
	}
	if recs[0]["password"] == "p@ssw0rd" {
		t.Error("password が素通りしています。マスキングが効いていません")
	}
	if recs[0]["bucket"] != "my-bucket" {
		t.Errorf("bucket = %v, want my-bucket（機密でない値は残すべき）", recs[0]["bucket"])
	}
}
