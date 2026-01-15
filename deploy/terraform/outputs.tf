# Outputs for CI/CD integration
#
# After `terraform apply`, these values are available:
#   terraform output -raw endpoint_id
#   terraform output -raw runsync_url
#
# Export to environment:
#   export RUNPOD_ENDPOINT_ID=$(terraform output -raw endpoint_id)

output "fly_secrets_command" {
  description = "Command to set Fly.io secrets"
  value       = <<-EOT
    fly secrets set \
      RUNPOD_ENDPOINT_ID=${runpod_endpoint.comfyui.id} \
      --app comfyui-mcp
  EOT
}

output "curl_health_check" {
  description = "Command to test the endpoint"
  value       = <<-EOT
    curl -X POST "https://api.runpod.ai/v2/${runpod_endpoint.comfyui.id}/runsync" \
      -H "Authorization: Bearer $RUNPOD_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"input": {"action": "health"}}'
  EOT
}
