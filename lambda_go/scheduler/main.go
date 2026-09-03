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
	"log"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
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

var s3Client *s3.Client

// リトライ実行器。スロットリングと一時的なサーバエラーに備える。
// テストからは Sleep / Rand を差し替えて実待機ゼロで検証する。
var retrier = awsretry.NewRetrier()

func init() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("AWS config 読み込み失敗: %v", err)
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
func handler(ctx context.Context, _ json.RawMessage) (Response, error) {
	// JST タイムゾーン
	jst := time.FixedZone("JST", 9*60*60)
	now := time.Now().In(jst)
	timestampStr := now.Format("2006-01-02T15:04:05+09:00")

	log.Printf("スケジュール実行開始: %s", timestampStr)

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
	err = retrier.Do(ctx, "PutObject", func(c context.Context) error {
		// bytes.Reader は初回の送信で読み切られるため、
		// リトライのたびにクロージャの内側で作り直す。
		// 外で1つだけ作ると2回目以降が空ボディになる。
		_, putErr := s3Client.PutObject(c, &s3.PutObjectInput{
			Bucket:      aws.String(bucketName),
			Key:         aws.String(reportKey),
			Body:        bytes.NewReader(body),
			ContentType: aws.String(contentType),
		})
		return putErr
	})
	if err != nil {
		return Response{}, fmt.Errorf("S3 書き込み失敗: %w", err)
	}

	log.Printf("レポートを S3 に保存しました: s3://%s/%s", bucketName, reportKey)

	return Response{
		StatusCode:  200,
		Status:      "success",
		ReportKey:   reportKey,
		GeneratedAt: timestampStr,
	}, nil
}

func main() {
	lambda.Start(handler)
}
