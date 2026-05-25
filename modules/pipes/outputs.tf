output "pipe_arn" {
  description = "EventBridge Pipe の ARN"
  value       = aws_pipes_pipe.this.arn
}

output "pipe_name" {
  description = "EventBridge Pipe の名前"
  value       = aws_pipes_pipe.this.name
}

output "sqs_queue_url" {
  description = "Pipes ソース SQS キューの URL（メッセージ送信先）"
  value       = aws_sqs_queue.source.url
}

output "sqs_queue_arn" {
  description = "Pipes ソース SQS キューの ARN"
  value       = aws_sqs_queue.source.arn
}
