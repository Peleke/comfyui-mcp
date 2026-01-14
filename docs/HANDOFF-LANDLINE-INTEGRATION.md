# Handoff: landline-landing Integration with comfyui-mcp HTTP Service

## Context

The `comfyui-mcp` package has been deployed as a secure HTTP service exposing image/audio/video generation endpoints. Your task is to integrate `landline-landing` (Next.js app) to consume this service.

---

## Architecture

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  Web Client     │     │  landline-landing   │     │ comfyui-mcp     │
│  (React)        │────▶│  (Next.js)          │────▶│ HTTP Service    │
│                 │     │                     │     │ (Fly.io)        │
└─────────────────┘     │  /api/generate/*    │     └────────┬────────┘
                        │  - Auth middleware  │              │
                        │  - Rate limiting    │              │ Tailscale VPN
                        │  - Request signing  │              │ (Private Mesh)
                        └─────────────────────┘              │
                                                             ▼
                                                    ┌─────────────────┐
                                                    │  RunPod GPU     │
                                                    │  (ComfyUI)      │
                                                    └────────┬────────┘
                                                             │
                                                             ▼
                                                    ┌─────────────────┐
                                                    │  Supabase       │
                                                    │  Storage        │
                                                    └─────────────────┘
```

---

## Security: API Key + HMAC Authentication

**All generation endpoints require authentication.**

### Required Headers

| Header | Description |
|--------|-------------|
| `X-API-Key` | Your API key (provided via secrets) |
| `X-Timestamp` | Current Unix timestamp in milliseconds |
| `X-Signature` | HMAC-SHA256 signature of `timestamp:body` |

### Signature Generation

```typescript
import { createHmac } from "crypto";

function generateAuthHeaders(body: unknown, apiKey: string, apiSecret: string) {
  const timestamp = Date.now().toString();
  const bodyString = typeof body === "string" ? body : JSON.stringify(body);

  const signature = createHmac("sha256", apiSecret)
    .update(`${timestamp}:${bodyString}`)
    .digest("hex");

  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
  };
}
```

### Request Window

Requests must be made within **5 minutes** of the timestamp to prevent replay attacks.

---

## Rate Limiting

Rate limiting is enforced via Upstash Redis. Response headers indicate your quota:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Requests allowed per window |
| `X-RateLimit-Remaining` | Requests remaining |
| `X-RateLimit-Reset` | Unix timestamp when limit resets |

### Tier Limits

| Tier | Requests/Min | Requests/Hour |
|------|--------------|---------------|
| Free | 10 | 100 |
| Pro | 100 | 1,000 |
| Enterprise | 1,000 | 10,000 |

Tier is determined by API key prefix (`free_`, `pro_`, `enterprise_`).

---

## Endpoints

Base URL: `https://comfyui-mcp.fly.dev` (or env `COMFYUI_SERVICE_URL`)

### Health Check (No Auth Required)
```
GET /health
Response: { "status": "healthy", "gpu": {...}, "latency_ms": 45 }

GET /ping
Response: { "reachable": true, "latency_ms": 45 }
```

### Synchronous Endpoints (Auth Required)

#### Portrait Generation
```
POST /portrait
Content-Type: application/json
X-API-Key: your-api-key
X-Timestamp: 1704912345000
X-Signature: hmac-sha256-hex

{
  "description": "Viking warrior with braided beard",
  "style": "realistic",
  "expression": "serious",
  "gender": "male",
  "seed": 42,
  "upload_to_cloud": true
}

Response:
{
  "success": true,
  "signedUrl": "https://xxx.supabase.co/storage/v1/object/sign/...",
  "localPath": "/tmp/comfyui-output/portrait_xxx.png",
  "prompt": "...",
  "model": "flux1-schnell-Q8_0.gguf",
  "taskId": "abc123"
}
```

#### TTS (Text-to-Speech)
```
POST /tts
{
  "text": "Hello, this is synthesized speech.",
  "voice_reference": "/workspace/ComfyUI/input/voices/morgan.wav",
  "speed": 1.0,
  "seed": -1,
  "upload_to_cloud": true
}

Response:
{
  "success": true,
  "signedUrl": "https://xxx.supabase.co/storage/v1/object/sign/...",
  "localPath": "/tmp/comfyui-output/tts_xxx.wav",
  "taskId": "abc123"
}
```

#### Lip-Sync Video
```
POST /lipsync
{
  "portrait_image": "https://xxx.supabase.co/.../portrait.png",
  "audio": "https://xxx.supabase.co/.../speech.wav",
  "model": "sonic",
  "upload_to_cloud": true
}

Response:
{
  "success": true,
  "signedUrl": "https://xxx.supabase.co/storage/v1/object/sign/...",
  "localPath": "/tmp/comfyui-output/lipsync_xxx.mp4",
  "taskId": "abc123"
}
```

### Async Endpoints (Auth Required, Job Queue)

For long-running jobs, use async endpoints. Requires `ENABLE_ASYNC_QUEUES=true` on the server.

#### Queue Portrait Generation
```
POST /portrait/async
{
  "description": "...",
  "callbackUrl": "https://your-app.com/api/webhooks/generation"  // optional
}

Response:
{
  "status": "queued",
  "jobId": "uuid-xxx",
  "pollUrl": "/jobs/portrait/uuid-xxx"
}
```

#### Poll Job Status
```
GET /jobs/portrait/{jobId}

Response (pending):
{ "id": "...", "status": "pending", "createdAt": "..." }

Response (complete):
{
  "id": "...",
  "status": "complete",
  "result": {
    "status": "complete",
    "result": { "localPath": "...", "signedUrl": "...", "prompt": "...", "model": "..." }
  },
  "createdAt": "...",
  "completedAt": "..."
}

Response (failed):
{ "id": "...", "status": "failed", "error": "...", "createdAt": "..." }
```

---

## landline-landing Implementation

### Directory Structure

```
src/
├── app/api/
│   ├── generate/
│   │   ├── portrait/route.ts
│   │   ├── tts/route.ts
│   │   ├── lipsync/route.ts
│   │   └── image/route.ts
│   └── health/route.ts
├── lib/
│   ├── comfyui-service.ts      # HTTP client with auth
│   └── api-auth.ts             # Supabase auth middleware
└── types/generation.ts
```

### Service Client with HMAC Auth

```typescript
// src/lib/comfyui-service.ts
import { createHmac } from "crypto";

const SERVICE_URL = process.env.COMFYUI_SERVICE_URL!;
const API_KEY = process.env.COMFYUI_API_KEY!;
const API_SECRET = process.env.COMFYUI_API_SECRET!;
const SERVICE_TIMEOUT = 5 * 60 * 1000;

function generateAuthHeaders(body: unknown) {
  const timestamp = Date.now().toString();
  const bodyString = typeof body === "string" ? body : JSON.stringify(body);

  const signature = createHmac("sha256", API_SECRET)
    .update(`${timestamp}:${bodyString}`)
    .digest("hex");

  return {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
  };
}

export async function callService<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ success: boolean; data?: T; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SERVICE_TIMEOUT);

  try {
    const response = await fetch(`${SERVICE_URL}${endpoint}`, {
      method: "POST",
      headers: generateAuthHeaders(body),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check rate limit
    const remaining = response.headers.get("X-RateLimit-Remaining");
    if (remaining && parseInt(remaining) < 5) {
      console.warn(`Rate limit warning: ${remaining} requests remaining`);
    }

    if (!response.ok) {
      if (response.status === 429) {
        const reset = response.headers.get("X-RateLimit-Reset");
        return { success: false, error: `Rate limited. Reset at ${reset}` };
      }
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || `Error: ${response.status}` };
    }

    return { success: true, data: await response.json() };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return { success: false, error: "Generation timed out" };
    }
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// Async job submission
export async function submitAsyncJob<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ success: boolean; jobId?: string; pollUrl?: string; error?: string }> {
  const result = await callService<{ status: string; jobId: string; pollUrl: string }>(
    `${endpoint}/async`,
    body
  );

  if (!result.success || !result.data) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    jobId: result.data.jobId,
    pollUrl: result.data.pollUrl,
  };
}

// Poll for job completion
export async function pollJob<T>(pollUrl: string, maxAttempts = 60, intervalMs = 5000): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${SERVICE_URL}${pollUrl}`, {
      headers: { "X-API-Key": API_KEY },
    });

    const job = await response.json();

    if (job.status === "complete") {
      return job.result as T;
    }

    if (job.status === "failed") {
      throw new Error(job.error || "Job failed");
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error("Job polling timeout");
}

// Convenience methods
export const generatePortrait = (params: PortraitParams) =>
  callService<PortraitResponse>("/portrait", params);

export const generatePortraitAsync = (params: PortraitParams) =>
  submitAsyncJob("/portrait", params);
```

### API Route Example

```typescript
// src/app/api/generate/portrait/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generatePortrait } from "@/lib/comfyui-service";
import { requireAuth } from "@/lib/api-auth";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { user, error: authError } = await requireAuth(req);
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  const body = await req.json();

  if (!body.description) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const result = await generatePortrait({
    ...body,
    upload_to_cloud: true,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    image: result.data?.signedUrl,
    expiresIn: 3600,
  });
}
```

---

## Environment Variables

### landline-landing (.env.local)

```bash
# comfyui-mcp HTTP service
COMFYUI_SERVICE_URL="https://comfyui-mcp.fly.dev"
COMFYUI_API_KEY="your-api-key"
COMFYUI_API_SECRET="your-hmac-secret"

# Supabase (already configured)
NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
```

### comfyui-mcp (Fly.io Secrets)

```bash
fly secrets set \
  COMFYUI_URL="http://runpod-comfyui:8188" \
  COMFYUI_API_KEYS="key1,key2,key3" \
  COMFYUI_API_SECRET="your-hmac-secret" \
  TAILSCALE_AUTHKEY="tskey-auth-xxx" \
  UPSTASH_REDIS_REST_URL="https://xxx.upstash.io" \
  UPSTASH_REDIS_REST_TOKEN="xxx" \
  SUPABASE_URL="https://xxx.supabase.co" \
  SUPABASE_SERVICE_KEY="eyJ..." \
  SUPABASE_BUCKET="generated-assets" \
  ENABLE_ASYNC_QUEUES="true"
```

---

## Error Handling

All routes return consistent error format:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (missing/invalid params) |
| 401 | Unauthorized (no/invalid auth or signature) |
| 429 | Rate limit exceeded |
| 500 | Server error (generation failed) |
| 503 | Service unavailable (async mode not enabled) |
| 504 | Gateway timeout (generation took too long) |

---

## Testing

```bash
# 1. Health check (no auth)
curl https://comfyui-mcp.fly.dev/health

# 2. Test with auth (generate signature first)
TIMESTAMP=$(date +%s000)
BODY='{"description":"Viking warrior"}'
SIGNATURE=$(echo -n "${TIMESTAMP}:${BODY}" | openssl dgst -sha256 -hmac "$API_SECRET" | cut -d' ' -f2)

curl -X POST https://comfyui-mcp.fly.dev/portrait \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -H "X-Timestamp: $TIMESTAMP" \
  -H "X-Signature: $SIGNATURE" \
  -d "$BODY"

# 3. Via landline-landing (with Supabase auth)
curl -X POST http://localhost:3000/api/generate/portrait \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=..." \
  -d '{"description": "Viking warrior"}'
```

---

## Summary

1. **Authentication**: API Key + HMAC signature on all generation endpoints
2. **Rate Limiting**: Per-key/per-IP with configurable tiers
3. **Async Jobs**: Queue + poll pattern for long-running generations
4. **Private Network**: Tailscale mesh between Fly.io and RunPod
5. **Storage**: All assets uploaded to Supabase with signed URLs

The web client talks to landline-landing, which authenticates users and signs requests to comfyui-mcp.
