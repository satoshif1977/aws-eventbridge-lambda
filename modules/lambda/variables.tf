variable "project" { type = string }
variable "env" { type = string }
variable "function_name" { type = string }
variable "source_dir" { type = string }
variable "tags" { type = map(string) }

variable "timeout" {
  type    = number
  default = 30
}

variable "memory_size" {
  type    = number
  default = 128
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "policy_statements" {
  type    = list(any)
  default = []
}

variable "log_retention_days" {
  description = "CloudWatch Logs の保持日数"
  type        = number
  default     = 30
}
