resource "aws_cloudwatch_event_rule" "renewal_nightly" {
  name                = "renewal-nightly"
  schedule_expression = "cron(0 2 * * ? *)"
}
