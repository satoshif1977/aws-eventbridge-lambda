// Pattern B（Go版）: S3 イベント駆動 Lambda
// S3 にファイルがアップロードされると EventBridge 経由で起動し、
// ファイル情報を DynamoDB に記録する。
//
// Python版との比較:
//   - コールドスタート: Go ~100ms vs Python ~300ms
//   - メモリ使用量: Go ~30MB vs Python ~60MB
//   - バイナリサイズ: Go ~8MB（単一バイナリ） vs Python（ランタイム込み）
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/satoshif1977/aws-eventbridge-lambda/internal/awslog"
	"github.com/satoshif1977/aws-eventbridge-lambda/internal/awsretry"
)

// ── EventBridge S3 イベント構造体 ────────────────────────────

// S3EventDetail は EventBridge 経由の S3 イベント detail フィールド
type S3EventDetail struct {
	Bucket struct {
		Name string `json:"name"`
	} `json:"bucket"`
	Object struct {
		Key  string `json:"key"`
		Size int64  `json:"size"`
	} `json:"object"`
}

// S3EventBridgeEvent は EventBridge から受け取る S3 イベント全体
type S3EventBridgeEvent struct {
	Time   string        `json:"time"`
	Detail S3EventDetail `json:"detail"`
}

// Response は Lambda 応答
type Response struct {
	StatusCode     int    `json:"statusCode"`
	Status         string `json:"status"`
	ProcessedCount int    `json:"processed_count"`
	ProcessedKey   string `json:"processed_key,omitempty"`
	Message        string `json:"message,omitempty"`
}

// ── AWS クライアント（init で初期化・コールドスタート時のみ実行）──

// DDBPutter は DynamoDB への書き込みを抽象化する。
// テストからモックを注入して、ログ出力まで検証できるようにする。
type DDBPutter interface {
	PutItem(
		ctx context.Context,
		params *dynamodb.PutItemInput,
		optFns ...func(*dynamodb.Options),
	) (*dynamodb.PutItemOutput, error)
}

var ddbClient DDBPutter

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
	r.OnRetry = awslog.RetryHook(l, "DynamoDB")
	return r
}

func init() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		logger.Error("AWS config の読み込みに失敗しました", "error", err.Error())
		os.Exit(1)
	}
	ddbClient = dynamodb.NewFromConfig(cfg)
}

// ── ヘルパー関数 ──────────────────────────────────────────────

// validateEvent はイベントのバケット名とキーが有効かチェックする。
func validateEvent(event S3EventBridgeEvent) bool {
	return event.Detail.Bucket.Name != "" && event.Detail.Object.Key != ""
}

// buildPK は S3 オブジェクトの DynamoDB パーティションキーを生成する。
// 例: "s3://my-bucket/uploads/test.pdf"
func buildPK(bucket, key string) string {
	return fmt.Sprintf("s3://%s/%s", bucket, key)
}

// ── ハンドラー ────────────────────────────────────────────────

// runHandler は S3 イベント 1 件を処理する。
//
// AWS クライアント・リトライ実行器・ロガーを引数で受け取ることで、
// handler から依存の生成を切り離し、出力まで検証できるようにしている。
func runHandler(
	ctx context.Context,
	event S3EventBridgeEvent,
	client DDBPutter,
	r awsretry.Retrier,
	logger *slog.Logger,
) (Response, error) {
	logger.Info("S3 イベントの処理を開始しました", "eventTime", event.Time)

	if !validateEvent(event) {
		logger.Warn("イベントの構造が不正です",
			"reason", "バケット名またはオブジェクトキーが取得できません")
		return Response{
			StatusCode: 400,
			Status:     "error",
			Message:    "Invalid event structure",
		}, nil
	}

	bucketName := event.Detail.Bucket.Name
	objectKey := event.Detail.Object.Key
	objectSize := event.Detail.Object.Size

	reqLogger := logger.With("bucket", bucketName, "key", objectKey)
	reqLogger.Info("処理対象を特定しました", "sizeBytes", objectSize)

	// JST タイムゾーン
	jst := time.FixedZone("JST", 9*60*60)
	now := time.Now().In(jst)
	pk := buildPK(bucketName, objectKey)
	processedAt := now.Format("2006-01-02T15:04:05+09:00")

	tableName := os.Getenv("DYNAMODB_TABLE_NAME")

	// ── DynamoDB に記録 ─────────────────────────────────────
	err := r.Do(ctx, "PutItem", func(c context.Context) error {
		_, putErr := client.PutItem(c, &dynamodb.PutItemInput{
			TableName: aws.String(tableName),
			Item: map[string]types.AttributeValue{
				"pk":           &types.AttributeValueMemberS{Value: pk},
				"processed_at": &types.AttributeValueMemberS{Value: processedAt},
				"bucket_name":  &types.AttributeValueMemberS{Value: bucketName},
				"object_key":   &types.AttributeValueMemberS{Value: objectKey},
				"object_size":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", objectSize)},
				"event_time":   &types.AttributeValueMemberS{Value: event.Time},
			},
		})
		return putErr
	})
	if err != nil {
		reqLogger.Error("DynamoDB への書き込みに失敗しました", "error", err.Error())
		return Response{}, fmt.Errorf("DynamoDB 書き込み失敗: %w", err)
	}

	reqLogger.Info("DynamoDB へ記録しました", "pk", pk)

	return Response{
		StatusCode:     200,
		Status:         "success",
		ProcessedCount: 1,
		ProcessedKey:   objectKey,
	}, nil
}

// handler は Lambda のエントリポイント。パッケージ変数を runHandler へ渡すだけ。
func handler(ctx context.Context, event S3EventBridgeEvent) (Response, error) {
	return runHandler(ctx, event, ddbClient, retrier, logger)
}

func main() {
	lambda.Start(handler)
}
