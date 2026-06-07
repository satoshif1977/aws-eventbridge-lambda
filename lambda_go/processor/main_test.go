package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// ── S3EventBridgeEvent パーステスト ──────────────────────────

func TestS3EventBridgeEventParsing(t *testing.T) {
	raw := `{
		"time": "2026-05-13T00:00:00Z",
		"detail": {
			"bucket": {"name": "my-bucket"},
			"object": {"key": "uploads/test.pdf", "size": 1024}
		}
	}`
	var event S3EventBridgeEvent
	if err := json.Unmarshal([]byte(raw), &event); err != nil {
		t.Fatalf("JSON パース失敗: %v", err)
	}
	if event.Detail.Bucket.Name != "my-bucket" {
		t.Errorf("バケット名が不一致: %s", event.Detail.Bucket.Name)
	}
	if event.Detail.Object.Key != "uploads/test.pdf" {
		t.Errorf("オブジェクトキーが不一致: %s", event.Detail.Object.Key)
	}
	if event.Detail.Object.Size != 1024 {
		t.Errorf("サイズが不一致: %d", event.Detail.Object.Size)
	}
	if event.Time != "2026-05-13T00:00:00Z" {
		t.Errorf("時刻が不一致: %s", event.Time)
	}
}

// ── validateEvent テスト ──────────────────────────────────────

func TestValidateEvent(t *testing.T) {
	tests := []struct {
		name   string
		bucket string
		key    string
		wantOK bool
	}{
		{"正常なイベント", "my-bucket", "uploads/test.txt", true},
		{"バケット名が空", "", "uploads/test.txt", false},
		{"キーが空", "my-bucket", "", false},
		{"両方空", "", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var event S3EventBridgeEvent
			event.Detail.Bucket.Name = tt.bucket
			event.Detail.Object.Key = tt.key
			got := validateEvent(event)
			if got != tt.wantOK {
				t.Errorf("期待 %v, 実際 %v", tt.wantOK, got)
			}
		})
	}
}

// ── buildPK テスト ────────────────────────────────────────────

func TestBuildPK(t *testing.T) {
	tests := []struct {
		name     string
		bucket   string
		key      string
		expected string
	}{
		{
			name:     "通常のパス",
			bucket:   "my-bucket",
			key:      "uploads/test.pdf",
			expected: "s3://my-bucket/uploads/test.pdf",
		},
		{
			name:     "ネストしたパス",
			bucket:   "input-bucket",
			key:      "2026/05/13/report.json",
			expected: "s3://input-bucket/2026/05/13/report.json",
		},
		{
			name:     "ルート直下のファイル",
			bucket:   "my-bucket",
			key:      "test.txt",
			expected: "s3://my-bucket/test.txt",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildPK(tt.bucket, tt.key)
			if got != tt.expected {
				t.Errorf("期待: %s, 実際: %s", tt.expected, got)
			}
		})
	}
}

func TestBuildPKPrefix(t *testing.T) {
	pk := buildPK("any-bucket", "any/key.txt")
	if !strings.HasPrefix(pk, "s3://") {
		t.Errorf("PK が s3:// で始まっていない: %s", pk)
	}
}

// ── Response 構造体テスト ─────────────────────────────────────

func TestResponseSuccess(t *testing.T) {
	resp := Response{
		StatusCode:     200,
		Status:         "success",
		ProcessedCount: 1,
		ProcessedKey:   "uploads/test.pdf",
	}
	if resp.StatusCode != 200 {
		t.Errorf("StatusCode が 200 でない: %d", resp.StatusCode)
	}
	if resp.ProcessedCount != 1 {
		t.Errorf("ProcessedCount が 1 でない: %d", resp.ProcessedCount)
	}
	if resp.ProcessedKey != "uploads/test.pdf" {
		t.Errorf("ProcessedKey が不一致: %s", resp.ProcessedKey)
	}
}

func TestResponseError(t *testing.T) {
	resp := Response{
		StatusCode: 400,
		Status:     "error",
		Message:    "Invalid event structure",
	}
	if resp.StatusCode != 400 {
		t.Errorf("StatusCode が 400 でない: %d", resp.StatusCode)
	}
	if resp.Message == "" {
		t.Error("エラー時は Message が空であってはならない")
	}
}

func TestResponseJSONMarshal(t *testing.T) {
	resp := Response{
		StatusCode:     200,
		Status:         "success",
		ProcessedCount: 1,
		ProcessedKey:   "uploads/test.pdf",
	}
	body, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Response の JSON エンコード失敗: %v", err)
	}
	got := string(body)
	if !strings.Contains(got, `"statusCode"`) {
		t.Error("statusCode フィールドが JSON に含まれていない")
	}
	if !strings.Contains(got, `"processed_key"`) {
		t.Error("processed_key フィールドが JSON に含まれていない")
	}
}

// ── buildPK 追加テスト ────────────────────────────────────────

func TestBuildPKWithSpecialChars(t *testing.T) {
	tests := []struct {
		name     string
		bucket   string
		key      string
		expected string
	}{
		{
			name:     "スペースを含むキー",
			bucket:   "my-bucket",
			key:      "uploads/my file.pdf",
			expected: "s3://my-bucket/uploads/my file.pdf",
		},
		{
			name:     "日本語を含むキー",
			bucket:   "my-bucket",
			key:      "uploads/テスト.pdf",
			expected: "s3://my-bucket/uploads/テスト.pdf",
		},
		{
			name:     "ハイフン・アンダースコアを含むバケット名",
			bucket:   "my-project_bucket-01",
			key:      "data/file.json",
			expected: "s3://my-project_bucket-01/data/file.json",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildPK(tt.bucket, tt.key)
			if got != tt.expected {
				t.Errorf("期待: %s, 実際: %s", tt.expected, got)
			}
		})
	}
}

func TestBuildPKContainsBucketAndKey(t *testing.T) {
	bucket := "test-bucket"
	key := "prefix/file.csv"
	pk := buildPK(bucket, key)
	if !strings.Contains(pk, bucket) {
		t.Errorf("PK にバケット名が含まれていない: %s", pk)
	}
	if !strings.Contains(pk, key) {
		t.Errorf("PK にキーが含まれていない: %s", pk)
	}
}

// ── ベンチマーク ──────────────────────────────────────────────

func BenchmarkBuildPK(b *testing.B) {
	for i := 0; i < b.N; i++ {
		buildPK("my-bucket", "uploads/test.pdf")
	}
}

func BenchmarkBuildPKNestedPath(b *testing.B) {
	for i := 0; i < b.N; i++ {
		buildPK("my-bucket", "2026/06/08/data/report.json")
	}
}

func BenchmarkValidateEvent(b *testing.B) {
	var event S3EventBridgeEvent
	event.Detail.Bucket.Name = "my-bucket"
	event.Detail.Object.Key = "uploads/test.pdf"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		validateEvent(event)
	}
}

func BenchmarkValidateEventInvalid(b *testing.B) {
	var event S3EventBridgeEvent // バケット名・キーが空
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		validateEvent(event)
	}
}

func BenchmarkS3EventBridgeEventJSONUnmarshal(b *testing.B) {
	raw := []byte(`{
		"time": "2026-06-08T00:00:00Z",
		"detail": {
			"bucket": {"name": "my-bucket"},
			"object": {"key": "uploads/test.pdf", "size": 1024}
		}
	}`)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var event S3EventBridgeEvent
		_ = json.Unmarshal(raw, &event)
	}
}

func BenchmarkResponseJSONMarshal(b *testing.B) {
	resp := Response{
		StatusCode:     200,
		Status:         "success",
		ProcessedCount: 1,
		ProcessedKey:   "uploads/test.pdf",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = json.Marshal(resp)
	}
}

// ── validateEvent 追加テスト ──────────────────────────────────

func TestValidateEventEdgeCases(t *testing.T) {
	tests := []struct {
		name   string
		bucket string
		key    string
		wantOK bool
	}{
		{"スペースのみのバケット名", " ", "key.txt", true},  // 空文字ではないため true
		{"スペースのみのキー", "bucket", " ", true},          // 空文字ではないため true
		{"長いバケット名", strings.Repeat("a", 63), "key.txt", true},
		{"深いパスのキー", "bucket", "a/b/c/d/e/f/g.txt", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var event S3EventBridgeEvent
			event.Detail.Bucket.Name = tt.bucket
			event.Detail.Object.Key = tt.key
			got := validateEvent(event)
			if got != tt.wantOK {
				t.Errorf("%s: 期待 %v, 実際 %v", tt.name, tt.wantOK, got)
			}
		})
	}
}

// ── S3EventBridgeEvent 追加テスト ─────────────────────────────

func TestS3EventDetailZeroSize(t *testing.T) {
	raw := `{
		"time": "2026-05-15T00:00:00Z",
		"detail": {
			"bucket": {"name": "my-bucket"},
			"object": {"key": "empty.txt", "size": 0}
		}
	}`
	var event S3EventBridgeEvent
	if err := json.Unmarshal([]byte(raw), &event); err != nil {
		t.Fatalf("JSON パース失敗: %v", err)
	}
	if event.Detail.Object.Size != 0 {
		t.Errorf("サイズ 0 が正しく解析されていない: %d", event.Detail.Object.Size)
	}
}

func TestS3EventDetailLargeSize(t *testing.T) {
	const largeSize = int64(5 * 1024 * 1024 * 1024) // 5GB
	raw := `{"time":"2026-05-15T00:00:00Z","detail":{"bucket":{"name":"b"},"object":{"key":"large.bin","size":5368709120}}}`
	var event S3EventBridgeEvent
	if err := json.Unmarshal([]byte(raw), &event); err != nil {
		t.Fatalf("JSON パース失敗: %v", err)
	}
	if event.Detail.Object.Size != largeSize {
		t.Errorf("大サイズが正しく解析されていない: 期待 %d, 実際 %d", largeSize, event.Detail.Object.Size)
	}
}

func TestS3EventBridgeEventRoundTrip(t *testing.T) {
	original := S3EventBridgeEvent{
		Time: "2026-05-15T12:00:00Z",
	}
	original.Detail.Bucket.Name = "round-trip-bucket"
	original.Detail.Object.Key = "test/round-trip.json"
	original.Detail.Object.Size = 2048

	body, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("JSON エンコード失敗: %v", err)
	}

	var decoded S3EventBridgeEvent
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("JSON デコード失敗: %v", err)
	}

	if decoded.Detail.Bucket.Name != original.Detail.Bucket.Name {
		t.Errorf("バケット名が不一致: 期待 %s, 実際 %s", original.Detail.Bucket.Name, decoded.Detail.Bucket.Name)
	}
	if decoded.Detail.Object.Key != original.Detail.Object.Key {
		t.Errorf("キーが不一致: 期待 %s, 実際 %s", original.Detail.Object.Key, decoded.Detail.Object.Key)
	}
	if decoded.Detail.Object.Size != original.Detail.Object.Size {
		t.Errorf("サイズが不一致: 期待 %d, 実際 %d", original.Detail.Object.Size, decoded.Detail.Object.Size)
	}
}

// ── Response 追加テスト ───────────────────────────────────────

func TestResponseZeroValue(t *testing.T) {
	var resp Response
	if resp.StatusCode != 0 {
		t.Errorf("ゼロ値の StatusCode は 0 であるべき: %d", resp.StatusCode)
	}
	if resp.ProcessedCount != 0 {
		t.Errorf("ゼロ値の ProcessedCount は 0 であるべき: %d", resp.ProcessedCount)
	}
}

func TestResponseAllFields(t *testing.T) {
	resp := Response{
		StatusCode:     200,
		Status:         "success",
		ProcessedCount: 3,
		ProcessedKey:   "uploads/batch.zip",
		Message:        "バッチ処理完了",
	}
	body, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("JSON エンコード失敗: %v", err)
	}
	got := string(body)
	for _, want := range []string{`"statusCode"`, `"status"`, `"processed_count"`, `"processed_key"`} {
		if !strings.Contains(got, want) {
			t.Errorf("JSON に %s が含まれていない: %s", want, got)
		}
	}
}
