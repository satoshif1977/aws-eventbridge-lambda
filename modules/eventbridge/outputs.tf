output "scheduler_rule_arn" { value = aws_cloudwatch_event_rule.scheduler.arn }
output "s3_trigger_rule_arn" { value = aws_cloudwatch_event_rule.s3_trigger.arn }
