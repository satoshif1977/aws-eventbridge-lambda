package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// ── DailyReport JSON テスト ───────────────────────────────────

func TestDailyReportJSONMarshal(t *testing.T) {
	report := DailyReport{
		ReportDate:     "2026-05-13",
		GeneratedAt:    "2026-05-13T09:00:00+09:00",
		Source:         "EventBridge Scheduler (Go)",
		Message:        "2026-05-13 の日次レポートを生成しました。",
		LambdaFunction: "test-function",
	}
	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatalf("JSON エンコード失敗: %v", err)
	}
	got := string(body)
	checks := []struct {
		label string
		want  string
	}{
		{"report_date フィールド", `"report_date"`},
		{"generated_at フィールド", `"generated_at"`},
		{"source フィールド", `"source"`},
		{"日付の値", "2026-05-13"},
		{"Source の値", "EventBridge Scheduler (Go)"},
	}
	for _, c := range checks {
		if !strings.Contains(got, c.want) {
			t.Errorf("%s が JSON に含まれていない", c.label)
		}
	}
}

// ── generateReportKey テスト ──────────────────────────────────

func TestGenerateReportKey(t *testing.T) {
	jst := time.FixedZone("JST", 9*60*60)
	tests := []struct {
		name     string
		t        time.Time
		expected string
	}{
		{
			name:     "通常の日付",
			t:        time.Date(2026, 5, 13, 9, 0, 0, 0, jst),
			expected: "reports/2026-05-13/daily-report.json",
		},
		{
			name:     "月と日が1桁",
			t:        time.Date(2026, 1, 5, 9, 0, 0, 0, jst),
			expected: "reports/2026-01-05/daily-report.json",
		},
		{
			name:     "年末",
			t:        time.Date(2026, 12, 31, 23, 59, 59, 0, jst),
			expected: "reports/2026-12-31/daily-report.json",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := generateReportKey(tt.t)
			if got != tt.expected {
				t.Errorf("期待: %s, 実際: %s", tt.expected, got)
			}
		})
	}
}

func TestGenerateReportKeyPrefix(t *testing.T) {
	jst := time.FixedZone("JST", 9*60*60)
	now := time.Now().In(jst)
	key := generateReportKey(now)
	if !strings.HasPrefix(key, "reports/") {
		t.Errorf("キーが reports/ で始まっていない: %s", key)
	}
	if !strings.HasSuffix(key, "/daily-report.json") {
		t.Errorf("キーが /daily-report.json で終わっていない: %s", key)
	}
}

// ── Response 構造体テスト ─────────────────────────────────────

func TestResponseSuccess(t *testing.T) {
	resp := Response{
		StatusCode:  200,
		Status:      "success",
		ReportKey:   "reports/2026-05-13/daily-report.json",
		GeneratedAt: "2026-05-13T09:00:00+09:00",
	}
	if resp.StatusCode != 200 {
		t.Errorf("StatusCode が 200 でない: %d", resp.StatusCode)
	}
	if resp.Status != "success" {
		t.Errorf("Status が success でない: %s", resp.Status)
	}
	if !strings.HasPrefix(resp.ReportKey, "reports/") {
		t.Errorf("ReportKey が reports/ で始まっていない: %s", resp.ReportKey)
	}
}

func TestResponseJSONMarshal(t *testing.T) {
	resp := Response{
		StatusCode:  200,
		Status:      "success",
		ReportKey:   "reports/2026-05-13/daily-report.json",
		GeneratedAt: "2026-05-13T09:00:00+09:00",
	}
	body, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Response の JSON エンコード失敗: %v", err)
	}
	got := string(body)
	if !strings.Contains(got, `"statusCode"`) {
		t.Error("statusCode フィールドが JSON に含まれていない")
	}
	if !strings.Contains(got, `"report_key"`) {
		t.Error("report_key フィールドが JSON に含まれていない")
	}
}
