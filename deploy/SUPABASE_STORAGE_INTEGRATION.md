# One-Shot Prompt: Wire Supabase Storage into RunPod Serverless Handler

## Context

Copy this entire file as a prompt to Claude tomorrow.

---

## The Task

Wire up Supabase cloud storage to the RunPod serverless handler so generated images/videos/audio persist with URLs instead of returning ephemeral base64 data.

## Current State

### What Exists

1. **Supabase Storage Provider** - `src/storage/supabase.ts`
   - Full implementation: upload, download, list, delete, signed URLs
   - Uses `@supabase/storage-js`
   - Configured via env vars (see below)

2. **Storage Provider Interface** - `src/storage/provider.ts`
   - Defines `StorageProvider` interface
   - `UploadResult`: `{ path, url, signedUrl, size }`

3. **RunPod Serverless Handler** - `deploy/serverless/handler.py`
   - Currently returns base64-encoded files in response
   - No cloud storage integration
   - Endpoint: `https://api.runpod.ai/v2/urauigb5h66a1y/run`

4. **Network Volume** - `g64svtzxd5` mounted at `/runpod-volume`
   - Contains models (checkpoints, etc.)
   - Could also store outputs temporarily

### Environment Variables Needed

```bash
# Supabase (check .env or fly secrets)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_xxxxx  # Service role key, NOT anon
SUPABASE_BUCKET=comfyui-outputs       # or whatever bucket name exists
```

### Current Handler Output Format

```python
# handler.py returns:
{
    "status": "success",
    "action": "portrait",
    "files": [
        {
            "type": "image",
            "filename": "ComfyUI_00001_.png",
            "data": "base64_encoded_data...",  # <-- This is what we want to replace
            "encoding": "base64"
        }
    ],
    "prompt_id": "xxx"
}
```

### Desired Output Format

```python
{
    "status": "success",
    "action": "portrait",
    "files": [
        {
            "type": "image",
            "filename": "ComfyUI_00001_.png",
            "url": "https://xxx.supabase.co/storage/v1/object/public/bucket/path/file.png",
            "signed_url": "https://xxx.supabase.co/storage/v1/object/sign/...",  # 1hr expiry
            "size": 1234567,
            "path": "outputs/2024-01-15/abc123/portrait.png"
        }
    ],
    "prompt_id": "xxx"
}
```

## Implementation Plan

### Option A: Add Supabase to Python Handler (Recommended)

Modify `deploy/serverless/handler.py` to upload files to Supabase before returning.

**Pros:**
- Single point of integration
- Files uploaded immediately after generation
- No round-trip through MCP server

**Changes Required:**

1. Add `supabase` to handler dependencies (or use raw `requests`)
2. Add env vars to RunPod endpoint/template
3. Modify `handler()` to upload files instead of base64 encoding
4. Generate unique paths (timestamp + UUID)
5. Return URLs instead of data

**Pseudocode:**

```python
# At top of handler.py
from supabase import create_client
import os

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "comfyui-outputs")

def upload_to_supabase(local_path: str, remote_path: str) -> dict:
    """Upload file to Supabase and return URLs."""
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    with open(local_path, "rb") as f:
        file_data = f.read()

    # Upload
    result = supabase.storage.from_(SUPABASE_BUCKET).upload(
        remote_path,
        file_data,
        {"content-type": guess_content_type(local_path), "upsert": "true"}
    )

    # Get URLs
    public_url = supabase.storage.from_(SUPABASE_BUCKET).get_public_url(remote_path)
    signed_url = supabase.storage.from_(SUPABASE_BUCKET).create_signed_url(remote_path, 3600)

    return {
        "url": public_url,
        "signed_url": signed_url["signedURL"],
        "path": remote_path,
        "size": len(file_data)
    }

# In handler(), replace the base64 encoding with:
for file_info in output_files:
    file_path = file_info["path"]

    # Generate unique remote path
    remote_path = f"outputs/{date.today()}/{uuid4()}/{file_info['filename']}"

    # Upload and get URLs
    upload_result = upload_to_supabase(file_path, remote_path)

    result = {
        "type": file_info["type"],
        "filename": file_info["filename"],
        **upload_result
    }
    results.append(result)
```

### Option B: Upload in MCP Server (Alternative)

Keep handler.py returning base64, have the TypeScript MCP server upload to Supabase.

**Pros:**
- Reuses existing `src/storage/supabase.ts`
- No Python changes

**Cons:**
- Extra network hop (RunPod -> MCP -> Supabase)
- Larger payloads over the wire
- MCP server needs to handle upload

**Where to modify:**
- `src/runpod-serverless-client.ts` or wherever RunPod responses are handled
- Decode base64, save temp file, upload via `SupabaseStorageProvider`

## Files to Modify

| File | Changes |
|------|---------|
| `deploy/serverless/handler.py` | Add Supabase upload, remove base64 encoding |
| `deploy/serverless/Dockerfile` | Add `supabase` pip package |
| RunPod Template (UI) | Add env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` |

## Testing

1. Rebuild Docker image: `docker buildx build --platform linux/amd64 -t pelekes/comfyui-serverless:v3 --push .`
2. Update RunPod template to use `:v3` tag
3. Add env vars to template
4. Delete/recreate endpoint to pick up new template
5. Test portrait generation - should return URLs not base64

## Verification

```bash
# Generate portrait
curl -X POST "https://api.runpod.ai/v2/urauigb5h66a1y/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{"input": {"action": "portrait", "description": "test"}}'

# Response should have:
# "url": "https://xxx.supabase.co/storage/v1/object/public/..."
# NOT "data": "base64..."

# Verify URL works
curl -I "https://xxx.supabase.co/storage/v1/object/public/..."
# Should return 200 OK with image/png content-type
```

## Edge Cases

1. **Large files (>10MB):** Already handled - current code checks size
2. **Bucket doesn't exist:** Handler should create or fail gracefully
3. **Auth errors:** Return clear error message with status
4. **Cleanup:** Consider auto-delete after X days (Supabase lifecycle rules)

## Rollback

If storage breaks, revert to base64 by:
1. Setting `SUPABASE_URL=""` (empty disables upload)
2. Handler falls back to base64 encoding

---

## RunPod Endpoint Info

- **Endpoint ID:** `urauigb5h66a1y`
- **Endpoint URL:** `https://api.runpod.ai/v2/urauigb5h66a1y`
- **Network Volume:** `g64svtzxd5` (100GB, US-TX-3)
- **Template:** `comfyui-serverless` with image `pelekes/comfyui-serverless:v2`
- **Working Actions:** `portrait`, `health`, `debug`
- **Pending:** `tts`, `lipsync`, `animate_panel` (need SONIC models)

## SONIC Model Downloads (Separate Task)

Models need HuggingFace auth - run in provisioner pod:
```bash
pip install huggingface_hub
huggingface-cli login  # Get token from https://huggingface.co/settings/tokens
cd /runpod-volume && rm -rf sonic
huggingface-cli download AIFSH/SONIC --local-dir sonic
```
