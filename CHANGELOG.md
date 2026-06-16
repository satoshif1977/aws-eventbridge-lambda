# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.5.0] - 2026-06-16

### Changed
- actions/checkout v4 -> v6
- actions/setup-node v4 -> v6
- codecov/codecov-action v6 -> v7

## [1.4.0] - 2026-05-27

### Fixed
- Checkov CKV_AWS_27: SQS queue に sqs_managed_sse_enabled = true を追加（暗号化対応）

### Changed
- CI アクション更新: actions/checkout v4→v6 / actions/setup-python v5→v6 / actions/setup-go v5→v6 / codecov/codecov-action v5→v6 / hashicorp/setup-terraform v3→v4
- hashicorp/aws プロバイダーを v5.0 → v6.46 に更新

### Docs
- スクリーンショット 7枚を docs/screenshots/ に移動・英語ファイル名に変更

## [1.3.0] - 2026-05-25

### Added
- Pattern C: EventBridge Pipes 追加（フィルター・エンリッチメント・ルーティングを1リソースで完結）
  - `lambda_src/enricher/index.py`（エンリッチメント Lambda: file_type / priority を付与）
  - `modules/pipes/main.tf`（SQS + aws_pipes_pipe + IAM ロール）
  - `modules/pipes/variables.tf` / `outputs.tf`
  - `environments/dev/main.tf` に enricher Lambda / pipes モジュール追加
- README に Pattern C セクション追加（Pattern B との比較表・アーキテクチャ図）

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
