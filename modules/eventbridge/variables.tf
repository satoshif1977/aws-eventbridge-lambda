variable "project" { type = string }
variable "env" { type = string }
variable "tags" { type = map(string) }
variable "scheduler_lambda_arn" { type = string }
variable "scheduler_lambda_name" { type = string }
variable "processor_lambda_arn" { type = string }
variable "processor_lambda_name" { type = string }
variable "input_bucket_name" { type = string }
