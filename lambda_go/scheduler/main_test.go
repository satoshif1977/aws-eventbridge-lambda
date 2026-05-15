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

// ── generateReportKey 追加テスト ──────────────────────────────

func TestGenerateReportKeyFormat(t *testing.T) {
	jst := time.FixedZone("JST", 9*60*60)
	t1 := time.Date(2026, 5, 15, 9, 0, 0, 0, jst)
	key := generateReportKey(t1)

	// "reports/YYYY-MM-DD/daily-report.json" の形式確認
	parts := strings.Split(key, "/")
	if len(parts) != 3 {
		t.Errorf("キーのパス区切りが 3 パーツでない: %s (count=%d)", key, len(parts))
	}
	if parts[0] != "reports" {
		t.Errorf("第1パーツが reports でない: %s", parts[0])
	}
	if len(parts[1]) != 10 { // YYYY-MM-DD = 10文字
		t.Errorf("日付パーツが 10 文字でない: %s (len=%d)", parts[1], len(parts[1]))
	}
	if parts[2] != "daily-report.json" {
		t.Errorf("ファイル名が daily-report.json でない: %s", parts[2])
	}
}

func TestGenerateReportKeyLeapYear(t *testing.T) {
	jst := time.FixedZone("JST", 9*60*60)
	tests := []struct {
		name     string
		t        time.Time
		expected string
	}{
		{
			name:     "うるう年 2月29日",
			t:        time.Date(2028, 2, 29, 9, 0, 0, 0, jst),
			expected: "reports/2028-02-29/daily-report.json",
		},
		{
			name:     "元旦",
			t:        time.Date(2026, 1, 1, 0, 0, 0, 0, jst),
			expected: "reports/2026-01-01/daily-report.json",
		},
		{
			name:     "大晦日",
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

func TestGenerateReportKeyUniquenessPerDay(t *testing.T) {
	jst := time.FixedZone("JST", 9*60*60)
	day1 := time.Date(2026, 5, 14, 9, 0, 0, 0, jst)
	day2 := time.Date(2026, 5, 15, 9, 0, 0, 0, jst)
	if generateReportKey(day1) == generateReportKey(day2) {
		t.Error("異なる日付でも同じキーが生成された")
	}
}

func TestGenerateReportKeySameDay(t *testing.T) {
	jst := time.FixedZone("JST", 9*60*60)
	morning := time.Date(2026, 5, 15, 9, 0, 0, 0, jst)
	evening := time.Date(2026, 5, 15, 21, 30, 0, 0, jst)
	if generateReportKey(morning) != generateReportKey(evening) {
		t.Error("同じ日付の異なる時刻でキーが変わってはいけない")
	}
}

// ── DailyReport 追加テスト ────────────────────────────────────

func TestDailyReportAllFields(t *testing.T) {
	report := DailyReport{
		ReportDate:     "2026-05-15",
		GeneratedAt:    "2026-05-15T09:00:00+09:00",
		Source:         "EventBridge Scheduler (Go)",
		Message:        "2026-05-15 の日次レポートを生成しました。",
		LambdaFunction: "my-scheduler-fn",
	}
	if report.ReportDate == "" {
		t.Error("ReportDate が空")
	}
	if report.GeneratedAt == "" {
		t.Error("GeneratedAt が空")
	}
	if report.Source == "" {
		t.Error("Source が空")
	}
	if report.LambdaFunction == "" {
		t.Error("LambdaFunction が空")
	}
}

func TestDailyReportRoundTrip(t *testing.T) {
	original := DailyReport{
		ReportDate:     "2026-05-15",
		GeneratedAt:    "2026-05-15T09:00:00+09:00",
		Source:         "EventBridge Scheduler (Go)",
		Message:        "テストレポート",
		LambdaFunction: "test-fn",
	}
	body, err := json.MarshalIndent(original, "", "  ")
	if err != nil {
		t.Fatalf("JSON エンコード失敗: %v", err)
	}
	var decoded DailyReport
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("JSON デコード失敗: %v", err)
	}
	if decoded.ReportDate != original.ReportDate {
		t.Errorf("ReportDate が不一致: 期待 %s, 実際 %s", original.ReportDate, decoded.ReportDate)
	}
	if decoded.Source != original.Source {
		t.Errorf("Source が不一致: 期待 %s, 実際 %s", original.Source, decoded.Source)
	}
	if decoded.LambdaFunction != original.LambdaFunction {
		t.Errorf("LambdaFunction が不一致: 期待 %s, 実際 %s", original.LambdaFunction, decoded.LambdaFunction)
	}
}

// ── Response 追加テスト ───────────────────────────────────────

func TestResponseAllFields(t *testing.T) {
	resp := Response{
		StatusCode:  200,
		Status:      "success",
		ReportKey:   "reports/2026-05-15/daily-report.json",
		GeneratedAt: "2026-05-15T09:00:00+09:00",
	}
	body, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("JSON エンコード失敗: %v", err)
	}
	got := string(body)
	for _, want := range []string{`"statusCode"`, `"status"`, `"report_key"`, `"generated_at"`} {
		if !strings.Contains(got, want) {
			t.Errorf("JSON に %s が含まれていない", want)
		}
	}
}

func TestResponseZeroValue(t *testing.T) {
	var resp Response
	if resp.StatusCode != 0 {
		t.Errorf("ゼロ値の StatusCode は 0 であるべき: %d", resp.StatusCode)
	}
	if resp.Status != "" {
		t.Errorf("ゼロ値の Status は空文字であるべき: %s", resp.Status)
	}
}
