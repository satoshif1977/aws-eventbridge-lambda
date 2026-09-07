// retry_hook_test.go: Retrier.OnRetry フックのユニットテストと awslog との結線検証
//
// OnRetry が未設定なら従来どおり log.Printf にフォールバックすること、
// 設定すればリトライを構造化ログとして残せることを確認する。
package awsretry

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"strings"
	"testing"
	"time"

	"github.com/aws/smithy-go"
	"github.com/satoshif1977/aws-eventbridge-lambda/internal/awslog"
)

// ── テスト用ヘルパー ──────────────────────────────────────────

// hookCall は OnRetry に渡された引数を記録する。
type hookCall struct {
	attempt int
	delay   time.Duration
	err     error
}

// hookRecorder は OnRetry の呼び出しを溜め込む。
type hookRecorder struct {
	calls []hookCall
}

func (r *hookRecorder) hook(attempt int, delay time.Duration, err error) {
	r.calls = append(r.calls, hookCall{attempt: attempt, delay: delay, err: err})
}

// captureStdLog は標準 log パッケージの出力を一時的に奪って返す。
func captureStdLog(t *testing.T, fn func()) string {
	t.Helper()
	buf := &bytes.Buffer{}
	originalWriter := log.Writer()
	originalFlags := log.Flags()
	log.SetOutput(buf)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(originalWriter)
		log.SetFlags(originalFlags)
	})
	fn()
	return buf.String()
}

// ── OnRetry フック ────────────────────────────────────────────

func TestRetrier_OnRetryが試行ごとに呼ばれる(t *testing.T) {
	sleeper := &retryTestSleeper{}
	recorder := &hookRecorder{}
	calls := 0

	retrier := Retrier{
		Config:  retryTestNoJitter(3),
		Sleep:   sleeper.Sleep,
		OnRetry: recorder.hook,
	}

	// 2 回失敗して 3 回目で成功するので、リトライは 2 回発生する
	err := retrier.Do(context.Background(), "PutItem", retryTestFlaky(2, retryTestThrottling, &calls))
	if err != nil {
		t.Fatalf("Do() = %v, want nil", err)
	}

	if len(recorder.calls) != 2 {
		t.Fatalf("OnRetry の呼び出し回数 = %d, want 2", len(recorder.calls))
	}
	for i, call := range recorder.calls {
		wantAttempt := i + 1
		if call.attempt != wantAttempt {
			t.Errorf("calls[%d].attempt = %d, want %d", i, call.attempt, wantAttempt)
		}
		if call.delay <= 0 {
			t.Errorf("calls[%d].delay = %v, want > 0", i, call.delay)
		}
		if call.err == nil {
			t.Errorf("calls[%d].err = nil, want エラー", i)
		}
	}
}

func TestRetrier_OnRetryに渡る待機時間はComputeDelayと一致する(t *testing.T) {
	sleeper := &retryTestSleeper{}
	recorder := &hookRecorder{}
	calls := 0
	cfg := retryTestNoJitter(3)

	retrier := Retrier{Config: cfg, Sleep: sleeper.Sleep, OnRetry: recorder.hook}
	if err := retrier.Do(context.Background(), "PutItem", retryTestFlaky(2, retryTestThrottling, &calls)); err != nil {
		t.Fatalf("Do() = %v, want nil", err)
	}

	for i, call := range recorder.calls {
		want := ComputeDelay(i+1, cfg, nil)
		if call.delay != want {
			t.Errorf("calls[%d].delay = %v, want %v", i, call.delay, want)
		}
	}
}

func TestRetrier_成功時はOnRetryを呼ばない(t *testing.T) {
	recorder := &hookRecorder{}
	retrier := Retrier{Config: retryTestNoJitter(3), OnRetry: recorder.hook}

	if err := retrier.Do(context.Background(), "PutItem", func(context.Context) error { return nil }); err != nil {
		t.Fatalf("Do() = %v, want nil", err)
	}
	if len(recorder.calls) != 0 {
		t.Errorf("OnRetry の呼び出し回数 = %d, want 0", len(recorder.calls))
	}
}

func TestRetrier_リトライ不能なエラーではOnRetryを呼ばない(t *testing.T) {
	recorder := &hookRecorder{}
	retrier := Retrier{Config: retryTestNoJitter(3), OnRetry: recorder.hook}
	nonRetryable := retryTestAPIError("ValidationException", smithy.FaultClient)

	err := retrier.Do(context.Background(), "PutItem", func(context.Context) error { return nonRetryable })
	if err == nil {
		t.Fatal("Do() = nil, want エラー")
	}
	if len(recorder.calls) != 0 {
		t.Errorf("OnRetry の呼び出し回数 = %d, want 0", len(recorder.calls))
	}
}

func TestRetrier_最終試行の失敗ではOnRetryを呼ばない(t *testing.T) {
	sleeper := &retryTestSleeper{}
	recorder := &hookRecorder{}
	retrier := Retrier{Config: retryTestNoJitter(2), Sleep: sleeper.Sleep, OnRetry: recorder.hook}

	err := retrier.Do(context.Background(), "PutItem", func(context.Context) error { return retryTestThrottling })
	if err == nil {
		t.Fatal("Do() = nil, want エラー")
	}
	// MaxAttempts=2 なら 1 回目の失敗でリトライし、2 回目（最終）の失敗では呼ばれない
	if len(recorder.calls) != 1 {
		t.Errorf("OnRetry の呼び出し回数 = %d, want 1", len(recorder.calls))
	}
}

// ── 既定動作（フック未設定）────────────────────────────────────

func TestRetrier_OnRetry未設定なら標準ログにフォールバックする(t *testing.T) {
	sleeper := &retryTestSleeper{}
	calls := 0

	output := captureStdLog(t, func() {
		retrier := Retrier{Config: retryTestNoJitter(3), Sleep: sleeper.Sleep}
		if err := retrier.Do(context.Background(), "PutItem", retryTestFlaky(1, retryTestThrottling, &calls)); err != nil {
			t.Fatalf("Do() = %v, want nil", err)
		}
	})

	if !strings.Contains(output, "リトライします") {
		t.Errorf("既定ログが出ていない: %q", output)
	}
	if !strings.Contains(output, "op=PutItem") {
		t.Errorf("操作名が含まれていない: %q", output)
	}
}

func TestRetrier_OnRetry設定時は標準ログに出さない(t *testing.T) {
	sleeper := &retryTestSleeper{}
	recorder := &hookRecorder{}
	calls := 0

	output := captureStdLog(t, func() {
		retrier := Retrier{Config: retryTestNoJitter(3), Sleep: sleeper.Sleep, OnRetry: recorder.hook}
		if err := retrier.Do(context.Background(), "PutItem", retryTestFlaky(1, retryTestThrottling, &calls)); err != nil {
			t.Fatalf("Do() = %v, want nil", err)
		}
	})

	if strings.Contains(output, "リトライします") {
		t.Errorf("フック設定時に既定ログが二重出力されている: %q", output)
	}
	if len(recorder.calls) != 1 {
		t.Errorf("OnRetry の呼び出し回数 = %d, want 1", len(recorder.calls))
	}
}

// ── awslog との結線 ───────────────────────────────────────────

func TestRetrier_awslogのRetryHookで構造化ログになる(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := awslog.New(awslog.Options{Level: awslog.LevelDebug, Writer: buf})
	sleeper := &retryTestSleeper{}
	calls := 0

	retrier := Retrier{
		Config:  retryTestNoJitter(3),
		Sleep:   sleeper.Sleep,
		OnRetry: awslog.RetryHook(logger, "PutItem"),
	}
	if err := retrier.Do(context.Background(), "PutItem", retryTestFlaky(1, retryTestThrottling, &calls)); err != nil {
		t.Fatalf("Do() = %v, want nil", err)
	}

	line := strings.TrimSpace(buf.String())
	if line == "" {
		t.Fatal("構造化ログが出力されていない")
	}

	var entry map[string]any
	if err := json.Unmarshal([]byte(line), &entry); err != nil {
		t.Fatalf("ログ行が JSON として読めない: %v (line=%q)", err, line)
	}

	if entry["level"] != "warn" {
		t.Errorf("level = %v, want warn", entry["level"])
	}
	if entry["operation"] != "PutItem" {
		t.Errorf("operation = %v, want PutItem", entry["operation"])
	}
	if entry["attempt"] == nil {
		t.Error("attempt が含まれていない")
	}
	if entry["delayMs"] == nil {
		t.Error("delayMs が含まれていない")
	}
	if entry["error"] == nil {
		t.Error("error が含まれていない")
	}
}

func TestRetrier_awslogがsilentならリトライログも出ない(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := awslog.New(awslog.Options{Level: awslog.LevelSilent, Writer: buf})
	sleeper := &retryTestSleeper{}
	calls := 0

	retrier := Retrier{
		Config:  retryTestNoJitter(3),
		Sleep:   sleeper.Sleep,
		OnRetry: awslog.RetryHook(logger, "PutItem"),
	}
	if err := retrier.Do(context.Background(), "PutItem", retryTestFlaky(1, retryTestThrottling, &calls)); err != nil {
		t.Fatalf("Do() = %v, want nil", err)
	}

	if buf.Len() != 0 {
		t.Errorf("silent なのに出力された: %q", buf.String())
	}
}

func TestRetryValue_OnRetryが呼ばれる(t *testing.T) {
	sleeper := &retryTestSleeper{}
	recorder := &hookRecorder{}
	attempts := 0

	retrier := Retrier{Config: retryTestNoJitter(3), Sleep: sleeper.Sleep, OnRetry: recorder.hook}
	got, err := RetryValue(context.Background(), retrier, "GetItem", func(context.Context) (string, error) {
		attempts++
		if attempts < 2 {
			return "", retryTestThrottling
		}
		return "ok", nil
	})
	if err != nil {
		t.Fatalf("RetryValue() = %v, want nil", err)
	}
	if got != "ok" {
		t.Errorf("RetryValue() = %q, want ok", got)
	}
	if len(recorder.calls) != 1 {
		t.Errorf("OnRetry の呼び出し回数 = %d, want 1", len(recorder.calls))
	}
}
