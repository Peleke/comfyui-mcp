# RunPod Setup Scripts

## First Time Setup

SSH into RunPod and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Peleke/comfyui-mcp/main/deploy/scripts/setup-comfyui.sh | bash
```

Or with Tailscale authkey (no interactive login):

```bash
export TAILSCALE_AUTHKEY="tskey-auth-xxxxx"
curl -fsSL https://raw.githubusercontent.com/Peleke/comfyui-mcp/main/deploy/scripts/setup-comfyui.sh | bash
```

This installs everything: git, python, Tailscale, ComfyUI, and starts it.

## After Pod Restart

```bash
/workspace/restart.sh
```

That's it. The setup script creates this for you.

## Manual Restart (if restart.sh missing)

```bash
tailscaled --tun=userspace-networking --state=/var/lib/tailscale/tailscaled.state &
sleep 3
tailscale up --hostname=runpod-comfyui
cd /workspace/ComfyUI
python3 main.py --listen 0.0.0.0 --port 8188 --enable-cors-header
```

## Verify

```bash
# Check Tailscale
tailscale status

# Check ComfyUI
curl http://localhost:8188/system_stats
```

## Connection Details

- **Tailscale hostname**: `runpod-comfyui`
- **ComfyUI URL**: `http://runpod-comfyui:8188`
