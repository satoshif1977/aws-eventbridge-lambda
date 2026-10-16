// Pattern A（Go版）: スケジュール実行 Lambda
// EventBridge の定期ルール（毎日 9:00 JST）から起動し、
// 日次レポートを生成して S3 に保存する。
//
// Python版との比較:
//   - コールドスタート: Go ~100ms vs Python ~300ms
//   - メモリ使用量: Go ~30MB vs Python ~60MB
//   - バイナリサイズ: Go ~8MB（単一バイナリ） vs Python（ランタイム込み）
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/satoshif1977/aws-eventbridge-lambda/internal/awslog"
	"github.com/satoshif1977/aws-eventbridge-lambda/internal/awsretry"
)

// ── レポート・応答構造体 ──────────────────────────────────────

// DailyReport は S3 に保存する日次レポートの構造
type DailyReport struct {
	ReportDate     string `json:"report_date"`
	GeneratedAt    string `json:"generated_at"`
	Source         string `json:"source"`
	Message        string `json:"message"`
	LambdaFunction string `json:"lambda_function"`
}

// Response は Lambda 応答
type Response struct {
	StatusCode  int    `json:"statusCode"`
	Status      string `json:"status"`
	ReportKey   string `json:"report_key"`
	GeneratedAt string `json:"generated_at"`
}

// ── AWS クライアント（init で初期化・コールドスタート時のみ実行）──

// S3Putter は S3 への書き込みを抽象化する。
// テストからモックを注入して、ログ出力まで検証できるようにする。
type S3Putter interface {
	PutObject(
		ctx context.Context,
		params *s3.PutObjectInput,
		optFns ...func(*s3.Options),
	) (*s3.PutObjectOutput, error)
}

var s3Client S3Putter

// 構造化ロガー。LOG_LEVEL で出力レベルを制御する。
// awslog を通すことで、キー名に応じた機密値のマスキングが効く。
var logger = awslog.NewFromEnv(awslog.Options{})

// リトライ実行器。スロットリングと一時的なサーバエラーに備える。
// テストからは Sleep / Rand を差し替えて実待機ゼロで検証する。
//
// OnRetry に awslog.RetryHook を挿すことで、リトライの発生が
// warn の 1 行 JSON として残り、Logs Insights で件数を追える。
var retrier = newRetrier(logger)

// newRetrier はロガーと結線済みの Retrier を返す。
func newRetrier(l *slog.Logger) awsretry.Retrier {
	r := awsretry.NewRetrier()
	r.OnRetry = awslog.RetryHook(l, "S3")
	return r
}

func init() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		logger.Error("AWS config の読み込みに失敗しました", "error", err.Error())
		os.Exit(1)
	}
	s3Client = s3.NewFromConfig(cfg)
}

// ── ヘルパー関数 ──────────────────────────────────────────────

// generateReportKey は JST の日付から S3 レポートキーを生成する。
// 例: "reports/2026-05-13/daily-report.json"
func generateReportKey(t time.Time) string {
	return fmt.Sprintf("reports/%s/daily-report.json", t.Format("2006-01-02"))
}

// ── ハンドラー ────────────────────────────────────────────────

// handler は EventBridge スケジュールイベントを受け取り、日次レポートを S3 に保存する。
// Go の json.RawMessage を使い、EventBridge スケジュールの任意のペイロードを受け付ける。
// runHandler は日次レポートを生成して S3 に保存する。
//
// AWS クライアント・リトライ実行器・ロガーを引数で受け取ることで、
// handler から依存の生成を切り離し、出力まで検証できるようにしている。
func runHandler(
	ctx context.Context,
	client S3Putter,
	r awsretry.Retrier,
	logger *slog.Logger,
) (Response, error) {
	// JST タイムゾーン
	jst := time.FixedZone("JST", 9*60*60)
	now := time.Now().In(jst)
	timestampStr := now.Format("2006-01-02T15:04:05+09:00")

	logger.Info("スケジュール実行を開始しました", "timestamp", timestampStr)

	bucketName := os.Getenv("REPORT_BUCKET_NAME")
	functionName := os.Getenv("AWS_LAMBDA_FUNCTION_NAME")
	reportKey := generateReportKey(now)

	// ── レポート生成 ────────────────────────────────────────
	report := DailyReport{
		ReportDate:     now.Format("2006-01-02"),
		GeneratedAt:    timestampStr,
		Source:         "EventBridge Scheduler (Go)",
		Message:        fmt.Sprintf("%s の日次レポートを生成しました。", now.Format("2006-01-02")),
		LambdaFunction: functionName,
	}

	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return Response{}, fmt.Errorf("JSON エンコード失敗: %w", err)
	}

	// ── S3 に保存 ───────────────────────────────────────────
	contentType := "application/json"
	err = r.Do(ctx, "PutObject", func(c context.Context) error {
		// bytes.Reader は初回の送信で読み切られるため、
		// リトライのたびにクロージャの内側で作り直す。
		// 外で1つだけ作ると2回目以降が空ボディになる。
		_, putErr := client.PutObject(c, &s3.PutObjectInput{
			Bucket:      aws.String(bucketName),
			Key:         aws.String(reportKey),
			Body:        bytes.NewReader(body),
			ContentType: aws.String(contentType),
		})
		return putErr
	})
	if err != nil {
		logger.Error("S3 への書き込みに失敗しました",
			"bucket", bucketName, "key", reportKey, "error", err.Error())
		return Response{}, fmt.Errorf("S3 書き込み失敗: %w", err)
	}

	logger.Info("レポートを S3 へ保存しました",
		"bucket", bucketName, "key", reportKey, "sizeBytes", len(body))

	return Response{
		StatusCode:  200,
		Status:      "success",
		ReportKey:   reportKey,
		GeneratedAt: timestampStr,
	}, nil
}

// handler は Lambda のエントリポイント。パッケージ変数を runHandler へ渡すだけ。
//
// EventBridge スケジュールの任意のペイロードを受け付けるため json.RawMessage で受ける。
func handler(ctx context.Context, _ json.RawMessage) (Response, error) {
	return runHandler(ctx, s3Client, retrier, logger)
}

func main() {
	lambda.Start(handler)
}
