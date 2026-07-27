package main

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// FuzzBuildPKPrefix は buildPK が任意のバケット名・キーで
// 常に "s3://" プレフィックスを返すことを検証する。
// 不変条件: DynamoDB の PK は必ず "s3://" で始まる。
func FuzzBuildPKPrefix(f *testing.F) {
	f.Add("my-bucket", "uploads/test.pdf")
	f.Add("input-bucket", "2026/05/13/report.json")
	f.Add("my-bucket", "test.txt")
	f.Add("", "key.txt")
	f.Add("bucket", "")
	f.Add("", "")
	f.Add("bucket-with-日本語", "uploads/テスト.pdf")

	f.Fuzz(func(t *testing.T, bucket, key string) {
		if !utf8.ValidString(bucket) || !utf8.ValidString(key) {
			t.Skip()
		}
		pk := buildPK(bucket, key)

		// 不変条件1: 常に "s3://" で始まる
		if !strings.HasPrefix(pk, "s3://") {
			t.Errorf("buildPK(%q, %q)=%q: 's3://' で始まっていない", bucket, key, pk)
		}
	})
}

// FuzzBuildPKContainsInputs は buildPK の出力に bucket と key が含まれることを検証する。
// 不変条件: PK はバケット名とキーを両方含む（検索・逆引き可能性の保証）。
func FuzzBuildPKContainsInputs(f *testing.F) {
	f.Add("my-bucket", "uploads/test.pdf")
	f.Add("prod-bucket", "logs/2026-07-27.log")
	f.Add("a", "b")

	f.Fuzz(func(t *testing.T, bucket, key string) {
		if !utf8.ValidString(bucket) || !utf8.ValidString(key) {
			t.Skip()
		}
		pk := buildPK(bucket, key)

		// 不変条件: bucket と key が出力に含まれる
		if !strings.Contains(pk, bucket) {
			t.Errorf("buildPK(%q, %q)=%q: bucket が含まれていない", bucket, key, pk)
		}
		if !strings.Contains(pk, key) {
			t.Errorf("buildPK(%q, %q)=%q: key が含まれていない", bucket, key, pk)
		}
	})
}

// FuzzValidateEventNoPanic は validateEvent が任意の文字列でパニックしないことを検証する。
// 不変条件: Lambda ハンドラーはどんな EventBridge イベントが来てもクラッシュしない。
func FuzzValidateEventNoPanic(f *testing.F) {
	f.Add("my-bucket", "uploads/test.pdf")
	f.Add("", "")
	f.Add(" ", " ")
	f.Add("bucket", "")
	f.Add("", "key.txt")
	f.Add("日本語バケット", "日本語/キー.txt")

	f.Fuzz(func(t *testing.T, bucket, key string) {
		if !utf8.ValidString(bucket) || !utf8.ValidString(key) {
			t.Skip()
		}
		var event S3EventBridgeEvent
		event.Detail.Bucket.Name = bucket
		event.Detail.Object.Key = key

		result := validateEvent(event)

		// 不変条件: bucket と key が両方非空のときのみ true
		if bucket != "" && key != "" && !result {
			t.Errorf("validateEvent(bucket=%q, key=%q)=false: 両方非空なら true であるべき", bucket, key)
		}
		if (bucket == "" || key == "") && result {
			t.Errorf("validateEvent(bucket=%q, key=%q)=true: どちらかが空なら false であるべき", bucket, key)
		}
	})
}
