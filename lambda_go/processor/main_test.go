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
