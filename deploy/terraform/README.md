# RunPod Serverless Terraform

Infrastructure as Code for deploying ComfyUI as a RunPod serverless endpoint.

## Prerequisites

1. [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.0.0
2. [RunPod API Key](https://www.runpod.io/console/user/settings)
3. Docker image pushed (see `../serverless/`)

## Quick Start

```bash
cd deploy/terraform

# 1. Configure
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your RunPod API key

# 2. Initialize
terraform init

# 3. Preview changes
terraform plan

# 4. Deploy
terraform apply
```

## Outputs

After deployment, get the endpoint ID:

```bash
# Get endpoint ID for Fly.io
terraform output -raw endpoint_id

# Get the full runsync URL
terraform output -raw runsync_url

# Get ready-to-run fly secrets command
terraform output fly_secrets_command

# Get health check curl command
terraform output curl_health_check
```

## CI/CD Integration

This repo includes GitHub Actions workflows for automated deployment:

- `.github/workflows/ci.yml` - Runs on PRs: tests, Terraform validation, Docker build
- `.github/workflows/deploy-serverless.yml` - Runs on main: builds Docker, deploys to RunPod

### Required Secrets

Set these in your GitHub repository settings:

| Secret | Description |
|--------|-------------|
| `RUNPOD_API_KEY` | Your RunPod API key |
| `RUNPOD_TEMPLATE_ID` | Template ID (from setup.sh) |
| `DOCKERHUB_USERNAME` | Docker Hub username |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `FLY_API_TOKEN` | (Optional) Fly.io API token |

### Manual Workflow Trigger

You can manually trigger deployments with options:

```bash
gh workflow run deploy-serverless.yml \
  --field skip_docker=true \
  --field skip_terraform=false
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `runpod_api_key` | (required) | RunPod API key |
| `endpoint_name` | `comfyui-talking-heads` | Name shown in RunPod console |
| `docker_image` | `pelekes/comfyui-serverless:latest` | Docker image to deploy |
| `gpu_ids` | `NVIDIA RTX 4090` | GPU type (4090, A100, etc.) |
| `min_workers` | `0` | Minimum workers (0 = scale to zero) |
| `max_workers` | `3` | Maximum concurrent workers |
| `idle_timeout` | `5` | Seconds before scaling down |
| `execution_timeout` | `300` | Max request time (5 min) |

## Costs

With default settings (scale to zero):
- **Idle**: $0/hour
- **Active (RTX 4090)**: ~$1.12/hour
- **Per request**: ~$0.003-0.10 depending on operation

## Destroying

To remove the endpoint:

```bash
terraform destroy
```

## State Management

For team usage, configure remote state:

```hcl
# Add to main.tf
terraform {
  backend "s3" {
    bucket = "your-terraform-state"
    key    = "comfyui-mcp/terraform.tfstate"
    region = "us-east-1"
  }
}
```
