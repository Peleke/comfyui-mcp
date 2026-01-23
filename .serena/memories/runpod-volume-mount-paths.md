# RunPod Volume Mount Paths

## IMPORTANT: Different mount paths for different pod types!

| Pod Type | Mount Path |
|----------|------------|
| **Serverless workers** | `/runpod-volume` |
| **Regular pods** (provisioner, GPU pods via UI) | `/workspace` |

## What this means:

- When uploading files via a provisioner pod, put them in `/workspace/voices`, `/workspace/avatars`, etc.
- The serverless handler (handler.py) expects the volume at `/runpod-volume`
- **They are the SAME network volume**, just mounted at different paths

## Provisioner pod workflow:

```bash
# Check where volume is mounted
ls /workspace  # Should show: sonic, f5_tts, checkpoints, voices, etc.

# Upload voices here
cd /workspace/voices
runpodctl receive <code>
```

## Network Volume ID: g64svtzxd5 (comfyui-models)
