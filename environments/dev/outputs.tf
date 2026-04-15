output "report_bucket_name" {
  description = "日次レポート保存先 S3 バケット名"
  value       = module.s3.report_bucket_name
}

output "input_bucket_name" {
  description = "処理トリガー用 S3 バケット名（ここにファイルを置くと Lambda が起動）"
  value       = module.s3.input_bucket_name
}

output "scheduler_function_name" {
  description = "Pattern A: スケジューラー Lambda 関数名"
  value       = module.lambda_scheduler.function_name
}

output "processor_function_name" {
  description = "Pattern B: プロセッサー Lambda 関数名"
  value       = module.lambda_processor.function_name
}

output "dynamodb_table_name" {
  description = "処理結果記録先 DynamoDB テーブル名"
  value       = aws_dynamodb_table.processed_files.name
}
