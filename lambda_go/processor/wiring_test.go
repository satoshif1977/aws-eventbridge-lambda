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

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
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
	if rec["operation"] != "DynamoDB" {
		t.Errorf("operation = %v, want DynamoDB", rec["operation"])
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
	err := r.Do(context.Background(), "PutItem", func(context.Context) error {
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

// ── runHandler ────────────────────────────────────────────────

// mockDDB は DDBPutter のテスト実装。
type mockDDB struct {
	calls int
	err   error
}

func (m *mockDDB) PutItem(
	_ context.Context,
	_ *dynamodb.PutItemInput,
	_ ...func(*dynamodb.Options),
) (*dynamodb.PutItemOutput, error) {
	m.calls++
	return &dynamodb.PutItemOutput{}, m.err
}

func validS3Event() S3EventBridgeEvent {
	ev := S3EventBridgeEvent{Time: "2026-10-16T02:00:00Z"}
	ev.Detail.Bucket.Name = "my-bucket"
	ev.Detail.Object.Key = "uploads/report.pdf"
	ev.Detail.Object.Size = 2048
	return ev
}

func TestRunHandlerは成功時に構造化ログを出す(t *testing.T) {
	buf := &bytes.Buffer{}
	l := awslog.New(awslog.Options{Level: awslog.LevelDebug, Writer: buf})
	ddb := &mockDDB{}

	resp, err := runHandler(context.Background(), validS3Event(), ddb, newRetrier(l), l)
	if err != nil {
		t.Fatalf("想定外のエラー: %v", err)
	}
	if resp.StatusCode != 200 || resp.ProcessedCount != 1 {
		t.Fatalf("resp = %+v", resp)
	}
	if ddb.calls != 1 {
		t.Fatalf("PutItem 呼び出し = %d, want 1", ddb.calls)
	}

	var started, recorded bool
	for _, rec := range decodeLines(t, buf) {
		switch rec["message"] {
		case "S3 イベントの処理を開始しました":
			started = true
		case "DynamoDB へ記録しました":
			recorded = true
			if rec["bucket"] != "my-bucket" {
				t.Errorf("bucket = %v", rec["bucket"])
			}
			if rec["key"] != "uploads/report.pdf" {
				t.Errorf("key = %v", rec["key"])
			}
		}
	}
	if !started || !recorded {
		t.Errorf("期待したログが出ていません start=%v recorded=%v", started, recorded)
	}
}

func TestRunHandlerは不正イベントをwarnで弾く(t *testing.T) {
	buf := &bytes.Buffer{}
	l := awslog.New(awslog.Options{Level: awslog.LevelDebug, Writer: buf})
	ddb := &mockDDB{}

	resp, err := runHandler(context.Background(), S3EventBridgeEvent{}, ddb, newRetrier(l), l)
	if err != nil {
		t.Fatalf("想定外のエラー: %v", err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("StatusCode = %d, want 400", resp.StatusCode)
	}
	if ddb.calls != 0 {
		t.Errorf("不正イベントで PutItem を呼んではいけません: %d", ddb.calls)
	}

	var warned bool
	for _, rec := range decodeLines(t, buf) {
		if rec["message"] == "イベントの構造が不正です" && rec["level"] == "warn" {
			warned = true
		}
	}
	if !warned {
		t.Error("warn ログが出ていません")
	}
}

func TestRunHandlerは書き込み失敗をerrorで残す(t *testing.T) {
	buf := &bytes.Buffer{}
	l := awslog.New(awslog.Options{Level: awslog.LevelDebug, Writer: buf})
	// リトライ対象外のエラーにして 1 回で打ち切らせる
	ddb := &mockDDB{err: errors.New("ValidationException")}

	r := newRetrier(l)
	r.Sleep = func(context.Context, time.Duration) error { return nil }

	_, err := runHandler(context.Background(), validS3Event(), ddb, r, l)
	if err == nil {
		t.Fatal("エラーが返るはずです")
	}

	var logged bool
	for _, rec := range decodeLines(t, buf) {
		if rec["message"] == "DynamoDB への書き込みに失敗しました" && rec["level"] == "error" {
			logged = true
		}
	}
	if !logged {
		t.Error("失敗が返るだけでログに残っていません")
	}
}
