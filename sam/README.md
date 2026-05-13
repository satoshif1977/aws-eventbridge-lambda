# SAM 版 EventBridge + Lambda ワークフロー

`terraform/` の Terraform 版と同等の構成を **AWS SAM（Serverless Application Model）** で実装したテンプレートです。
SAM は CloudFormation の拡張で、サーバーレスアプリ特有の繰り返し記述を大幅に削減できます。

## Terraform との設計差異

| 機能 | Terraform（3リソース） | SAM（1ブロック） |
|---|---|---|
| EventBridge ルール作成 | `aws_cloudwatch_event_rule` | `Events:` ブロック内に自動生成 |
| EventBridge ターゲット設定 | `aws_cloudwatch_event_target` | 同上（自動） |
| Lambda 呼び出し権限付与 | `aws_lambda_permission` | 同上（自動） |
| IAM ロール作成 | `aws_iam_role` + `aws_iam_policy` | `Policies:` リストから自動生成 |
| 共通設定（ランタイム等）| `locals {}` + 各モジュール変数 | `Globals:` セクション一箇所で管理 |
| デプロイ | `terraform plan` → `terraform apply` | `sam build` → `sam deploy` |

## 構成リソース

| リソース | SAM/CFn タイプ |
|---|---|
| S3（レポート保存用） | `AWS::S3::Bucket` |
| S3（処理トリガー用・EventBridge 通知有効） | `AWS::S3::Bucket` |
| DynamoDB（処理結果記録） | `AWS::DynamoDB::Table` |
| Lambda（scheduler・毎日 9:00 JST 実行） | `AWS::Serverless::Function` |
| Lambda（processor・S3 イベント駆動） | `AWS::Serverless::Function` |
| EventBridge ルール（スケジュール） | Events: 自動生成 |
| EventBridge ルール（S3 イベント） | Events: 自動生成 |

## デプロイ方法

### 前提条件

```bash
# SAM CLI インストール確認
sam --version

# AWS 認証設定
aws configure  # または aws-vault exec <profile> --
```

### 1. ビルド

`lambda_src/` を zip 化し、`.aws-sam/build/` に配置します。

```bash
cd aws-eventbridge-lambda/
sam build --template sam/template.yaml
```

### 2. デプロイ（初回：ガイド付き）

```bash
sam deploy --guided
```

対話形式で以下を入力します:
- Stack Name: `eventbridge-lambda-dev`
- AWS Region: `ap-northeast-1`
- Parameter ProjectName: `eventbridge-lambda`
- Parameter Environment: `dev`
- Confirm changes before deploy: `y`
- Allow SAM CLI IAM role creation: `y`

設定は `samconfig.toml` に保存され、次回以降は `sam deploy` のみで OK です。

### 3. デプロイ（2回目以降）

```bash
sam deploy --template sam/template.yaml
```

### 4. スタック削除

```bash
aws cloudformation delete-stack --stack-name eventbridge-lambda-dev
```

> S3 バケットにオブジェクトがある場合は先に削除が必要です。

## ローカルテスト（SAM Local）

```bash
# scheduler Lambda をローカル実行
sam local invoke SchedulerFunction \
  --template sam/template.yaml \
  --env-vars '{"SchedulerFunction": {"REPORT_BUCKET_NAME": "my-test-bucket"}}'

# processor Lambda をローカル実行
sam local invoke ProcessorFunction \
  --template sam/template.yaml \
  --event ../lambda_src/processor/tests/event.json
```

## トラブルシューティング

### `S3 bucket already exists` エラー

バケット名に `${AWS::AccountId}` を含めているため通常は衝突しませんが、
同一アカウントで既に存在する場合は `ProjectName` または `Environment` を変更してください。

### `DeletionProtectionEnabled` でスタック削除が失敗する

DynamoDB に削除保護を設定しているため、先にコンソールまたは CLI で無効化が必要です:

```bash
aws dynamodb update-table \
  --table-name eventbridge-lambda-dev-processed-files \
  --deletion-protection-enabled false
```

### `sam build` で `requirements.txt not found` エラー

`lambda_src/scheduler/` または `lambda_src/processor/` に `requirements.txt` が必要です。
boto3 は Lambda 実行環境に含まれるので、空ファイルで問題ありません:

```bash
touch lambda_src/scheduler/requirements.txt
touch lambda_src/processor/requirements.txt
```
