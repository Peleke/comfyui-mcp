# ComfyUI RunPod Serverless Infrastructure
#
# Prerequisites:
#   1. Create template via RunPod console or API (see setup.sh)
#   2. Set template_id in terraform.tfvars
#
# Deploy with:
#   cd deploy/terraform
#   ./setup.sh              # Creates template, outputs template_id
#   tofu init
#   tofu apply
#
# Outputs the endpoint ID for use in other services.

terraform {
  required_version = ">= 1.0.0"

  required_providers {
    runpod = {
      source  = "decentralized-infrastructure/runpod"
      version = ">= 1.0"
    }
  }
}

# Configure the RunPod provider
provider "runpod" {
  api_key = var.runpod_api_key
}

# Variables
variable "runpod_api_key" {
  description = "RunPod API key"
  type        = string
  sensitive   = true
}

variable "template_id" {
  description = "RunPod template ID (create via setup.sh or console)"
  type        = string
}

variable "endpoint_name" {
  description = "Name for the serverless endpoint"
  type        = string
  default     = "comfyui-talking-heads"
}

variable "gpu_type_ids" {
  description = "GPU type IDs to use (in order of preference)"
  type        = list(string)
  default     = ["NVIDIA GeForce RTX 4090", "NVIDIA RTX A6000", "NVIDIA A100-SXM4-80GB"]
}

variable "min_workers" {
  description = "Minimum number of workers (0 = scale to zero)"
  type        = number
  default     = 0
}

variable "max_workers" {
  description = "Maximum number of workers"
  type        = number
  default     = 3
}

variable "idle_timeout" {
  description = "Idle timeout in seconds before scaling down"
  type        = number
  default     = 5
}

variable "execution_timeout_ms" {
  description = "Maximum execution time in milliseconds"
  type        = number
  default     = 300000  # 5 minutes
}

# Create the serverless endpoint
resource "runpod_endpoint" "comfyui" {
  name        = var.endpoint_name
  template_id = var.template_id

  # GPU configuration
  gpu_type_ids = var.gpu_type_ids
  gpu_count    = 1

  # Worker scaling
  workers_min = var.min_workers
  workers_max = var.max_workers

  # Timeouts
  idle_timeout         = var.idle_timeout
  execution_timeout_ms = var.execution_timeout_ms

  # Scaling strategy
  scaler_type  = "QUEUE_DELAY"
  scaler_value = 4  # Add workers after 4s queue delay

  # Enable FlashBoot for faster cold starts
  flashboot = true
}

# Outputs
output "endpoint_id" {
  description = "The RunPod serverless endpoint ID"
  value       = runpod_endpoint.comfyui.id
}

output "endpoint_url" {
  description = "The full endpoint URL for API calls"
  value       = "https://api.runpod.ai/v2/${runpod_endpoint.comfyui.id}"
}

output "runsync_url" {
  description = "URL for synchronous requests"
  value       = "https://api.runpod.ai/v2/${runpod_endpoint.comfyui.id}/runsync"
}

output "run_url" {
  description = "URL for asynchronous requests"
  value       = "https://api.runpod.ai/v2/${runpod_endpoint.comfyui.id}/run"
}
