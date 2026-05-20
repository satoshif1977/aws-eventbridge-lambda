# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.2.0] - 2026-05-19

### Added
- CONTRIBUTING.md 追加（PR プロセス・スタイルガイド）

## [1.1.0] - 2026-05-13

### Added
- Go Lambda 並置実装（`lambda_go/` ディレクトリ）
  - `lambda_go/processor/main.go`（S3 EventBridge → DynamoDB）
  - `lambda_go/scheduler/main.go`（スケジュール → S3 日次レポート）
  - `lambda_go/go.mod`（Go 1.21 / aws-lambda-go / aws-sdk-go-v2）
- SAM テンプレート追加（`sam/template.yaml`）
  - EventBridge + Lambda x2 + S3 x2 + DynamoDB を SAM で一元管理
- SECURITY.md 追加
- README に Python vs Go 比較表・ビルド手順・トラブルシューティング追加

## [1.0.0] - 2026-03-10

### Added
- 初回実装：Amazon EventBridge + Lambda（Python）による イベント駆動アーキテクチャ
  - S3 オブジェクト作成イベントを受信 → DynamoDB に記録
  - EventBridge スケジュール → Lambda → S3 日次レポート生成
- Terraform IaC（EventBridge / Lambda / S3 / DynamoDB / IAM）
- GitHub Actions CI（Python lint + Checkov セキュリティスキャン）
