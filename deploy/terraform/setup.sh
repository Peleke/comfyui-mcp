#!/bin/bash
# Setup script for ComfyUI RunPod Serverless
#
# Creates a serverless template via RunPod API and outputs the template_id
# for use with Terraform/OpenTofu.
#
# Usage:
#   export RUNPOD_API_KEY=your-api-key
#   ./setup.sh
#
# The script will output a template_id to add to terraform.tfvars

set -e

# Configuration
TEMPLATE_NAME="${TEMPLATE_NAME:-comfyui-serverless}"
DOCKER_IMAGE="${DOCKER_IMAGE:-pelekes/comfyui-serverless:latest}"
CONTAINER_DISK_GB="${CONTAINER_DISK_GB:-20}"

# Check for API key
if [ -z "$RUNPOD_API_KEY" ]; then
    echo "Error: RUNPOD_API_KEY environment variable is not set"
    echo ""
    echo "Get your API key from: https://www.runpod.io/console/user/settings"
    echo "Then run: export RUNPOD_API_KEY=your-api-key"
    exit 1
fi

# Check if template already exists
echo "Checking for existing template '$TEMPLATE_NAME'..."
EXISTING=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $RUNPOD_API_KEY" \
    --data '{
        "query": "query { myself { serverlessDiscount podTemplates { id name imageName isServerless } } }"
    }' \
    https://api.runpod.io/graphql)

# Parse existing templates
EXISTING_ID=$(echo "$EXISTING" | python3 -c "
import json, sys
data = json.load(sys.stdin)
templates = data.get('data', {}).get('myself', {}).get('podTemplates', [])
for t in templates:
    if t.get('name') == '$TEMPLATE_NAME' and t.get('isServerless'):
        print(t['id'])
        break
" 2>/dev/null || echo "")

if [ -n "$EXISTING_ID" ]; then
    echo "Found existing template: $EXISTING_ID"
    echo ""
    echo "Add to terraform.tfvars:"
    echo "  template_id = \"$EXISTING_ID\""
    exit 0
fi

# Create new serverless template
echo "Creating serverless template '$TEMPLATE_NAME'..."
RESULT=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $RUNPOD_API_KEY" \
    --data "{
        \"query\": \"mutation { saveTemplate(input: { name: \\\"$TEMPLATE_NAME\\\", imageName: \\\"$DOCKER_IMAGE\\\", containerDiskInGb: $CONTAINER_DISK_GB, volumeInGb: 0, dockerArgs: \\\"\\\", isServerless: true, env: [{ key: \\\"PYTHONUNBUFFERED\\\", value: \\\"1\\\" }] }) { id name imageName isServerless } }\"
    }" \
    https://api.runpod.io/graphql)

# Parse result
TEMPLATE_ID=$(echo "$RESULT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if 'errors' in data:
    print('ERROR:', data['errors'], file=sys.stderr)
    sys.exit(1)
template = data.get('data', {}).get('saveTemplate', {})
if template:
    print(template.get('id', ''))
" 2>&1)

if [ -z "$TEMPLATE_ID" ] || [[ "$TEMPLATE_ID" == ERROR* ]]; then
    echo "Failed to create template:"
    echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"
    exit 1
fi

echo ""
echo "✓ Template created successfully!"
echo ""
echo "Template ID: $TEMPLATE_ID"
echo ""
echo "Add to terraform.tfvars:"
echo "  template_id = \"$TEMPLATE_ID\""
echo ""
echo "Or run:"
echo "  echo 'template_id = \"$TEMPLATE_ID\"' >> terraform.tfvars"
