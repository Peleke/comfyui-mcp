#!/bin/bash
set -e

echo "=== comfyui-mcp startup ==="

# Start Tailscale daemon in userspace mode (for containers without TUN device)
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "Starting Tailscale..."
    tailscaled --tun=userspace-networking --state=/var/lib/tailscale/tailscaled.state &
    sleep 3

    # Authenticate with Tailscale
    tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname=fly-comfyui-mcp --accept-routes

    # Wait for Tailscale to be ready
    echo "Waiting for Tailscale connection..."
    for i in {1..30}; do
        if tailscale status --json | grep -q '"Online":true'; then
            echo "Tailscale connected!"
            tailscale status
            break
        fi
        sleep 1
    done
else
    echo "TAILSCALE_AUTHKEY not set, skipping Tailscale"
fi

# Start the HTTP server
echo "Starting comfyui-mcp HTTP server..."
exec node dist/http-server.js
