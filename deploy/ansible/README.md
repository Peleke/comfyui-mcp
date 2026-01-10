# Ansible Deployment for RunPod GPU Pipeline

Automate RunPod pod setup for ComfyUI + custom nodes + models.

## Prerequisites

```bash
# Install Ansible
pip install ansible

# Or on macOS
brew install ansible
```

## Quick Start

### 1. Configure Inventory

Set environment variables for your RunPod pod:

```bash
# Get these from RunPod dashboard → Pod → Connect → SSH
export RUNPOD_HOST="123.45.67.89"
export RUNPOD_SSH_PORT="22222"
export RUNPOD_SSH_KEY="~/.ssh/id_ed25519"  # Optional, defaults to this
```

Or copy and edit the inventory file:

```bash
cp inventory/runpod.yml inventory/runpod-local.yml
# Edit inventory/runpod-local.yml with your pod details
```

### 2. Run Playbooks

```bash
cd deploy/ansible

# Full setup (ComfyUI + all models + custom nodes)
ansible-playbook playbooks/full-setup.yml

# Quick update (pull latest code, restart)
ansible-playbook playbooks/quick-update.yml

# Health check
ansible-playbook playbooks/health-check.yml
```

## Playbooks

| Playbook | Description | Time |
|----------|-------------|------|
| `full-setup.yml` | Complete installation with all models | 15-30 min |
| `quick-update.yml` | Update code and restart services | 1-2 min |
| `health-check.yml` | Verify system health and GPU status | 10 sec |

## Customization

### Skip Large Model Downloads

```bash
# Only base setup without Flux/SDXL models
ansible-playbook playbooks/full-setup.yml \
  -e "install_flux=false install_sdxl=false"
```

### Install Only Specific Components

```bash
# Only ComfyUI and custom nodes
ansible-playbook playbooks/full-setup.yml --tags "comfyui,custom-nodes"

# Only models
ansible-playbook playbooks/full-setup.yml --tags "models"

# Only restart services
ansible-playbook playbooks/quick-update.yml --tags "restart"
```

### Add Custom Models

Edit `inventory/runpod.yml` to add more models:

```yaml
vars:
  sdxl_models:
    - name: my_custom_model
      url: "https://civitai.com/api/download/models/XXXXX"
      dest: "{{ models_dir }}/checkpoints/my_custom_model.safetensors"
```

## Directory Structure

```
ansible/
├── ansible.cfg           # Ansible configuration
├── inventory/
│   ├── runpod.yml        # Template inventory (uses env vars)
│   └── .gitignore        # Ignore local inventory files
├── playbooks/
│   ├── full-setup.yml    # Complete installation
│   ├── quick-update.yml  # Fast updates
│   └── health-check.yml  # System verification
└── roles/
    ├── comfyui/          # Base ComfyUI installation
    ├── models/           # AI model downloads
    ├── custom-nodes/     # F5-TTS, LatentSync, etc.
    └── tts/              # TTS-specific setup
```

## What Gets Installed

### ComfyUI Base
- Latest ComfyUI from GitHub
- Python dependencies
- Systemd service for auto-start

### Custom Nodes
- **F5-TTS-ComfyUI** - Voice cloning TTS
- **ComfyUI-LatentSyncWrapper** - Lip-sync video generation
- **ComfyUI-GGUF** - Quantized model support
- **ComfyUI-VideoHelperSuite** - Video processing
- **ComfyUI-Manager** - Node management UI

### Models (Optional)
- **Flux fp8** - Fast, high-quality generation
- **SDXL checkpoints** - Various styles
- **RealESRGAN** - 4x upscaling
- **F5-TTS model** - Voice cloning

## Troubleshooting

### Connection Issues

```bash
# Test SSH connection
ssh -p $RUNPOD_SSH_PORT root@$RUNPOD_HOST

# Check Ansible connectivity
ansible runpod -m ping
```

### Model Download Failures

Large models may timeout. Re-run with longer timeout:

```bash
ansible-playbook playbooks/full-setup.yml --tags models \
  -e "ansible_timeout=600"
```

### Service Won't Start

Check logs on the pod:

```bash
ssh -p $RUNPOD_SSH_PORT root@$RUNPOD_HOST "journalctl -u comfyui -f"
```

## Integration with MCP

After running the playbooks, your RunPod pod exposes ComfyUI on port 8188.

1. Get the proxy URL from RunPod dashboard
2. Set `COMFYUI_URL` environment variable:
   ```bash
   export COMFYUI_URL="https://<pod-id>-8188.proxy.runpod.net"
   ```
3. Test connection:
   ```bash
   curl $COMFYUI_URL/system_stats
   ```
