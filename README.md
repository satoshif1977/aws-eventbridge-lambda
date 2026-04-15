# aws-eventbridge-lambda

![Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-orange?logo=anthropic)
![Claude Cowork](https://img.shields.io/badge/Daily%20Use-Claude%20Cowork-blueviolet?logo=anthropic)
![Claude Skills](https://img.shields.io/badge/Custom-Skills%20Configured-green?logo=anthropic)
![Terraform](https://img.shields.io/badge/Terraform-623CE4?style=flat&logo=terraform&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-232F3E?style=flat&logo=amazon-aws&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)

Amazon EventBridge + AWS Lambda による**スケジュール実行**と**S3 イベント駆動**の 2 パターンを Terraform で IaC 化した PoC。

---

## アーキテクチャ

### Pattern A: スケジュール実行（定期レポート生成）

```
EventBridge Scheduler
（毎日 9:00 JST / cron）
        ↓
  AWS Lambda
（日次レポート生成）
        ↓
  Amazon S3
（reports/YYYY-MM-DD/daily-report.json）
```

### Pattern B: S3 イベント駆動（ファイル処理自動化）

```
ファイルアップロード
        ↓
  Amazon S3（input バケット）
        ↓ EventBridge通知（Object Created）
  Amazon EventBridge
        ↓
  AWS Lambda
（ファイル情報を処理）
        ↓
  Amazon DynamoDB
（処理結果を記録）
```

---

## 技術スタック

| カテゴリ | 技術 |
|---|---|
| イベント管理 | Amazon EventBridge（スケジュール / イベントパターン） |
| 処理 | AWS Lambda（Python 3.11） |
| ストレージ | Amazon S3（レポート保存 / イベントトリガー） |
| DB | Amazon DynamoDB（処理結果記録 / PAY_PER_REQUEST） |
| IaC | Terraform（モジュール構成） |
| 監視 | Amazon CloudWatch Logs（7日保持） |

---

## ディレクトリ構成

```
aws-eventbridge-lambda/
├── lambda_src/
│   ├── scheduler/          # Pattern A: 定期レポート生成 Lambda
│   │   └── index.py
│   └── processor/          # Pattern B: S3 イベント処理 Lambda
│       └── index.py
├── modules/
│   ├── lambda/             # Lambda 関数 + IAM ロール（共通モジュール）
│   ├── eventbridge/        # EventBridge ルール + Lambda 実行権限
│   └── s3/                 # S3 バケット + EventBridge 通知設定
├── environments/
│   └── dev/
│       ├── main.tf         # モジュール統合 + DynamoDB
│       ├── variables.tf
│       ├── outputs.tf
│       └── terraform.tfvars.example
└── docs/
```

---

## デプロイ手順

### 1. Terraform apply

```bash
cd environments/dev
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

### 2. Pattern A 動作確認（手動テスト）

```bash
# Lambda を手動で即時実行
aws lambda invoke \
  --function-name eventbridge-lambda-dev-scheduler \
  --payload '{}' \
  response.json

# S3 にレポートが保存されたか確認
aws s3 ls s3://$(terraform output -raw report_bucket_name)/reports/ --recursive
```

### 3. Pattern B 動作確認（ファイルアップロード）

```bash
# input バケットにファイルをアップロード → Lambda が自動起動
echo "test data" > test.txt
aws s3 cp test.txt s3://$(terraform output -raw input_bucket_name)/

# DynamoDB に記録されたか確認
aws dynamodb scan --table-name $(terraform output -raw dynamodb_table_name)
```

### 4. リソース削除

```bash
terraform destroy
```

---

## IAM 設計（最小権限）

| 関数 | 権限 | 対象リソース |
|---|---|---|
| scheduler | `s3:PutObject` | report バケットのみ |
| processor | `dynamodb:PutItem` | 処理結果テーブルのみ |
| 共通 | CloudWatch Logs 書き込み | 自関数のロググループのみ |

---

## 技術的なポイント・工夫

- **2 パターンの EventBridge 活用**: `schedule_expression`（cron）と `event_pattern`（S3 Object Created）を 1 リポジトリで実装・比較できる
- **S3 → EventBridge 通知**: `aws_s3_bucket_notification` で `eventbridge = true` を設定するだけで S3 イベントが EventBridge に流れる（SNS / SQS 不要）
- **Lambda モジュールの共通化**: 2 つの Lambda 関数を同一モジュールで管理。`policy_statements` 変数で関数ごとの IAM ポリシーを注入する設計
- **最小権限 IAM**: 各 Lambda は必要最小限のリソース ARN のみに権限を付与
- **DynamoDB PAY_PER_REQUEST**: 検証環境のため従量課金。本番では Provisioned に変更してコストを安定化する

---

## コスト目安（検証時）

| リソース | 概算 |
|---|---|
| Lambda（月 30 回スケジュール実行） | ほぼ無料枠内 |
| EventBridge（カスタムイベント） | 100 万件まで $1 |
| S3（少量のレポートファイル） | ほぼ無料枠内 |
| DynamoDB（PAY_PER_REQUEST / 少量） | ほぼ無料枠内 |

> 検証後は `terraform destroy` でリソース削除を推奨。

---

## 副業・面談でのアピールポイント

- **「Lambda のトリガーを使い分けられる」**: スケジュール（定期バッチ）とイベント駆動（リアルタイム処理）の 2 パターンを実装
- **「S3 → EventBridge の連携を知っている」**: 旧来の S3 → SNS/SQS 経由ではなく EventBridge native 連携（より柔軟なフィルタリングが可能）
- **「Terraform モジュールを再利用できる」**: Lambda モジュールを 2 関数で共用する設計を実演できる

---

## AI 活用について

本プロジェクトは以下の Anthropic ツールを活用して開発しています。

| ツール | 用途 |
|---|---|
| **Claude Code** | インフラ設計・コード生成・デバッグ・コードレビュー。コミットまで一貫してサポート |
| **Claude Cowork** | 技術調査・設計相談・ドキュメント作成を日常的に活用。AI との協働を業務フローに組み込んでいる |
| **カスタム Skills** | Terraform / Python / AWS に特化した Skills を設定・継続的に更新。自分の技術スタックに最適化したワークフローを構築 |

> AI を「使う」だけでなく、自分の業務・技術スタックに合わせて**設定・運用・改善し続ける**ことを意識しています。

---

## 関連リポジトリ

- [terraform-aws-operations](https://github.com/satoshif1977/terraform-aws-operations) - CloudWatch 監視・SNS 通知・Runbook（Lambda 監視アラームも含む）
- [aws-step-functions-bedrock](https://github.com/satoshif1977/aws-step-functions-bedrock) - Step Functions + Bedrock による AI ワークフロー
- [aws-ecs-bedrock-chat](https://github.com/satoshif1977/aws-ecs-bedrock-chat) - ECS Fargate + Bedrock チャットアプリ
