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
	"log"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
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

var ddbClient *dynamodb.Client

// リトライ実行器。スロットリングと一時的なサーバエラーに備える。
// テストからは Sleep / Rand を差し替えて実待機ゼロで検証する。
var retrier = awsretry.NewRetrier()

func init() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("AWS config 読み込み失敗: %v", err)
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

func handler(ctx context.Context, event S3EventBridgeEvent) (Response, error) {
	log.Printf("S3 イベント処理開始: %s", event.Time)

	if !validateEvent(event) {
		log.Println("バケット名またはオブジェクトキーが取得できませんでした")
		return Response{
			StatusCode: 400,
			Status:     "error",
			Message:    "Invalid event structure",
		}, nil
	}

	bucketName := event.Detail.Bucket.Name
	objectKey := event.Detail.Object.Key
	objectSize := event.Detail.Object.Size

	log.Printf("処理対象: s3://%s/%s (%d bytes)", bucketName, objectKey, objectSize)

	// JST タイムゾーン
	jst := time.FixedZone("JST", 9*60*60)
	now := time.Now().In(jst)
	pk := buildPK(bucketName, objectKey)
	processedAt := now.Format("2006-01-02T15:04:05+09:00")

	tableName := os.Getenv("DYNAMODB_TABLE_NAME")

	// ── DynamoDB に記録 ─────────────────────────────────────
	err := retrier.Do(ctx, "PutItem", func(c context.Context) error {
		_, putErr := ddbClient.PutItem(c, &dynamodb.PutItemInput{
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
		return Response{}, fmt.Errorf("DynamoDB 書き込み失敗: %w", err)
	}

	log.Printf("DynamoDB に記録しました: pk=%s", pk)

	return Response{
		StatusCode:     200,
		Status:         "success",
		ProcessedCount: 1,
		ProcessedKey:   objectKey,
	}, nil
}

func main() {
	lambda.Start(handler)
}
