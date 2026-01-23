# v34 Test Commands

**Status**: Built and pushed, waiting for RunPod template update

## 1. Update RunPod Template
Change image to: `pelekes/comfyui-serverless:v34`

## 2. Test Portrait with save_to_avatars

```bash
curl -s -X POST "https://api.runpod.ai/v2/urauigb5h66a1y/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "action": "portrait",
      "model": "Deliberate_v5.safetensors",
      "description": "Odin, Norse god, one eye, grey beard, wise, portrait",
      "save_to_avatars": true,
      "avatar_name": "odin"
    }
  }' | jq .
```

Expected response includes:
```json
{
  "avatar_saved": "avatars/odin.png",
  "lipsync_ready": true
}
```

## 3. Test Lipsync with Saved Avatar

```bash
curl -s -X POST "https://api.runpod.ai/v2/urauigb5h66a1y/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "action": "lipsync",
      "portrait_image": "avatars/odin.png",
      "audio": "voices/talk_male_10s.wav"
    }
  }' | jq .
```

## 4. Health Check

```bash
curl -s -X POST "https://api.runpod.ai/v2/urauigb5h66a1y/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"health"}}' | jq .
```

## New in v34

- `save_to_avatars`: Boolean - saves portrait to avatars folder
- `avatar_name`: String - filename for the avatar (auto-adds .png)
- Response includes `avatar_saved` path and `lipsync_ready: true`
