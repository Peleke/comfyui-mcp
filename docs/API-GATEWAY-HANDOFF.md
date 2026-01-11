# API Gateway Handoff: landline-landing

## Overview

Expose comfyui-mcp generation tools as HTTP endpoints for web client consumption. This enables any web app to trigger image/audio/video generation and retrieve results via signed URLs.

---

## Architecture

```
┌─────────────┐     ┌─────────────────────────────────────┐     ┌─────────────┐
│ Web Client  │     │ landline-landing (Next.js)          │     │ RunPod GPU  │
│             │────▶│                                     │────▶│ (ComfyUI)   │
│ React/etc   │     │  /api/generate/portrait             │     └─────────────┘
└─────────────┘     │  /api/generate/tts                  │            │
       ▲            │  /api/generate/lipsync              │            │
       │            │  /api/gallery                       │            ▼
       │            │                                     │     ┌─────────────┐
       │            │  - Supabase Auth                    │     │ Supabase    │
       │            │  - Rate Limiting                    │────▶│ Storage     │
       │            │  - Request Validation               │     └─────────────┘
       │            └─────────────────────────────────────┘            │
       │                                                               │
       └───────────────────── Signed URL ─────────────────────────────┘
```

---

## Dependencies

```bash
# In landline-landing
npm install @peleke/comfyui-mcp
```

The package exports:
- `ComfyUIClient` - Client for ComfyUI communication
- `createPortrait` - Portrait generation
- `ttsGenerate` - Voice cloning / TTS
- `lipSyncGenerate` - Talking head video
- `generateImage` - Generic image generation
- `checkConnection`, `pingComfyUI` - Health checks

---

## API Routes

### Directory Structure

```
src/app/api/
├── generate/
│   ├── portrait/
│   │   └── route.ts       # POST - Generate character portrait
│   ├── tts/
│   │   └── route.ts       # POST - Text-to-speech with voice cloning
│   ├── lipsync/
│   │   └── route.ts       # POST - Lip-sync video from portrait + audio
│   └── image/
│       └── route.ts       # POST - Generic image generation
├── health/
│   └── route.ts           # GET - ComfyUI health check
└── gallery/
    ├── route.ts           # GET - List generated assets
    └── sign/
        └── route.ts       # POST - Generate fresh signed URL
```

---

## Implementation

### Shared Client Setup

```typescript
// src/lib/comfyui.ts
import { ComfyUIClient } from "@peleke/comfyui-mcp";

let client: ComfyUIClient | null = null;

export function getComfyUIClient(): ComfyUIClient {
  if (!client) {
    const url = process.env.COMFYUI_URL;
    if (!url) {
      throw new Error("COMFYUI_URL not configured");
    }
    client = new ComfyUIClient({
      url,
      timeout: 10 * 60 * 1000, // 10 min for long generations
    });
  }
  return client;
}
```

### Auth Middleware

```typescript
// src/lib/api-auth.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

export async function requireAuth(req: NextRequest) {
  const cookieStore = cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, error: "Unauthorized" };
  }

  return { user, error: null };
}
```

### Portrait Generation Endpoint

```typescript
// src/app/api/generate/portrait/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createPortrait } from "@peleke/comfyui-mcp/tools/avatar";
import { getComfyUIClient } from "@/lib/comfyui";
import { requireAuth } from "@/lib/api-auth";

export const maxDuration = 300; // 5 min timeout (Vercel)

interface PortraitRequest {
  description: string;
  style?: "realistic" | "anime" | "painterly" | "comic";
  expression?: string;
  gender?: "male" | "female" | "neutral";
  seed?: number;
}

export async function POST(req: NextRequest) {
  // Auth check
  const { user, error } = await requireAuth(req);
  if (error) {
    return NextResponse.json({ error }, { status: 401 });
  }

  // Parse and validate request
  const body: PortraitRequest = await req.json();

  if (!body.description) {
    return NextResponse.json(
      { error: "description is required" },
      { status: 400 }
    );
  }

  try {
    const client = getComfyUIClient();

    const result = await createPortrait({
      description: body.description,
      style: body.style || "realistic",
      expression: body.expression || "neutral",
      gender: body.gender || "neutral",
      seed: body.seed,
      upload_to_cloud: true,  // Always upload for web clients
    }, client);

    return NextResponse.json({
      success: true,
      image: result.signedUrl || result.remote_url,
      path: result.remote_path,
      expiresIn: 3600, // Signed URL expiry in seconds
    });

  } catch (err) {
    console.error("Portrait generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
```

### TTS Generation Endpoint

```typescript
// src/app/api/generate/tts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ttsGenerate } from "@peleke/comfyui-mcp/tools/tts";
import { getComfyUIClient } from "@/lib/comfyui";
import { requireAuth } from "@/lib/api-auth";

export const maxDuration = 120; // 2 min timeout

interface TTSRequest {
  text: string;
  voice_reference?: string;  // Path on RunPod or Supabase URL
  speed?: number;
  seed?: number;
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth(req);
  if (error) {
    return NextResponse.json({ error }, { status: 401 });
  }

  const body: TTSRequest = await req.json();

  if (!body.text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const client = getComfyUIClient();

    const result = await ttsGenerate({
      text: body.text,
      voice_reference: body.voice_reference || "/workspace/ComfyUI/input/voices/default.wav",
      speed: body.speed || 1.0,
      seed: body.seed || -1,
      upload_to_cloud: true,
    }, client);

    return NextResponse.json({
      success: true,
      audio: result.signedUrl || result.remote_url,
      path: result.remote_path,
      expiresIn: 3600,
    });

  } catch (err) {
    console.error("TTS generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
```

### Lip-Sync Endpoint

```typescript
// src/app/api/generate/lipsync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { lipSyncGenerate } from "@peleke/comfyui-mcp/tools/lipsync";
import { getComfyUIClient } from "@/lib/comfyui";
import { requireAuth } from "@/lib/api-auth";

export const maxDuration = 300; // 5 min - lip-sync is slow

interface LipSyncRequest {
  portrait_image: string;  // Supabase URL or path
  audio: string;           // Supabase URL or path
  model?: "sonic" | "latentsync";
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth(req);
  if (error) {
    return NextResponse.json({ error }, { status: 401 });
  }

  const body: LipSyncRequest = await req.json();

  if (!body.portrait_image || !body.audio) {
    return NextResponse.json(
      { error: "portrait_image and audio are required" },
      { status: 400 }
    );
  }

  try {
    const client = getComfyUIClient();

    const result = await lipSyncGenerate({
      portrait_image: body.portrait_image,
      audio: body.audio,
      model: body.model || "sonic",
      upload_to_cloud: true,
    }, client);

    return NextResponse.json({
      success: true,
      video: result.signedUrl || result.remote_url,
      path: result.remote_path,
      expiresIn: 3600,
    });

  } catch (err) {
    console.error("Lip-sync generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
```

### Health Check Endpoint

```typescript
// src/app/api/health/route.ts
import { NextResponse } from "next/server";
import { checkConnection, pingComfyUI } from "@peleke/comfyui-mcp/tools/health";
import { getComfyUIClient } from "@/lib/comfyui";

export async function GET() {
  try {
    const client = getComfyUIClient();

    const [ping, health] = await Promise.all([
      pingComfyUI(client),
      checkConnection({}, client),
    ]);

    return NextResponse.json({
      status: ping.reachable ? "healthy" : "unhealthy",
      latency_ms: ping.latency_ms,
      gpu: health.gpu,
      comfyui_version: health.system?.comfyui_version,
    });

  } catch (err) {
    return NextResponse.json(
      { status: "unhealthy", error: err instanceof Error ? err.message : "Unknown error" },
      { status: 503 }
    );
  }
}
```

---

## Request/Response Schemas

### Portrait Generation

**Request:**
```typescript
POST /api/generate/portrait
{
  "description": "Viking warrior with braided beard",  // Required
  "style": "realistic",      // Optional: realistic, anime, painterly, comic
  "expression": "serious",   // Optional: neutral, happy, angry, surprised, etc.
  "gender": "male",          // Optional: male, female, neutral
  "seed": 42                 // Optional: for reproducibility
}
```

**Response:**
```typescript
{
  "success": true,
  "image": "https://xxx.supabase.co/storage/v1/object/sign/...",
  "path": "portraits/1704912345-42.png",
  "expiresIn": 3600
}
```

### TTS Generation

**Request:**
```typescript
POST /api/generate/tts
{
  "text": "Hello, this is a test.",  // Required
  "voice_reference": "/workspace/ComfyUI/input/voices/morgan.wav",  // Optional
  "speed": 1.0,                       // Optional: 0.5 - 2.0
  "seed": -1                          // Optional: -1 for random
}
```

**Response:**
```typescript
{
  "success": true,
  "audio": "https://xxx.supabase.co/storage/v1/object/sign/...",
  "path": "speech/1704912345.wav",
  "expiresIn": 3600
}
```

### Lip-Sync Generation

**Request:**
```typescript
POST /api/generate/lipsync
{
  "portrait_image": "https://xxx.supabase.co/.../portrait.png",  // Required
  "audio": "https://xxx.supabase.co/.../speech.wav",             // Required
  "model": "sonic"                                                // Optional
}
```

**Response:**
```typescript
{
  "success": true,
  "video": "https://xxx.supabase.co/storage/v1/object/sign/...",
  "path": "videos/1704912345.mp4",
  "expiresIn": 3600
}
```

---

## Error Responses

All endpoints return consistent error format:

```typescript
{
  "error": "Description of what went wrong"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (missing/invalid params) |
| 401 | Unauthorized (no/invalid auth) |
| 500 | Server error (generation failed) |
| 503 | Service unavailable (ComfyUI down) |

---

## Rate Limiting

Implement via middleware or Vercel's built-in:

```typescript
// src/middleware.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "1 m"),  // 10 requests per minute
  analytics: true,
});

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/generate")) {
    const ip = req.ip ?? "127.0.0.1";
    const { success, limit, reset, remaining } = await ratelimit.limit(ip);

    if (!success) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": reset.toString(),
          }
        }
      );
    }
  }
}

export const config = {
  matcher: "/api/:path*",
};
```

---

## Job Queue Pattern (Optional)

For long-running generations, use a job queue:

```typescript
// src/app/api/generate/portrait/route.ts (async version)
import { Queue } from "quirrel/next";

export const portraitQueue = Queue(
  "api/generate/portrait/worker",
  async (job: { userId: string; params: PortraitRequest }) => {
    const client = getComfyUIClient();
    const result = await createPortrait({ ...job.params, upload_to_cloud: true }, client);

    // Notify user via webhook, email, or realtime
    await notifyUser(job.userId, result);
  }
);

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth(req);
  if (error) return NextResponse.json({ error }, { status: 401 });

  const body = await req.json();

  // Enqueue job
  const job = await portraitQueue.enqueue({
    userId: user.id,
    params: body,
  });

  return NextResponse.json({
    success: true,
    jobId: job.id,
    status: "queued",
    pollUrl: `/api/jobs/${job.id}`,
  });
}
```

---

## Environment Variables

```bash
# Required
COMFYUI_URL="https://<pod-id>-8188.proxy.runpod.net"

# Supabase (for storage)
NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
SUPABASE_SERVICE_KEY="eyJ..."
SUPABASE_BUCKET="generated-assets"

# Rate limiting (optional)
UPSTASH_REDIS_REST_URL="https://xxx.upstash.io"
UPSTASH_REDIS_REST_TOKEN="xxx"
```

---

## Client Usage Example

```typescript
// React component
async function generatePortrait(description: string) {
  const response = await fetch("/api/generate/portrait", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, style: "realistic" }),
  });

  if (!response.ok) {
    const { error } = await response.json();
    throw new Error(error);
  }

  const { image } = await response.json();
  return image;  // Signed URL ready to display
}

// Usage
const imageUrl = await generatePortrait("Viking warrior with braided beard");
// <img src={imageUrl} /> - works directly, no CORS issues
```

---

## Files to Create

```
src/
├── app/api/
│   ├── generate/
│   │   ├── portrait/route.ts
│   │   ├── tts/route.ts
│   │   ├── lipsync/route.ts
│   │   └── image/route.ts
│   ├── health/route.ts
│   └── gallery/
│       ├── route.ts
│       └── sign/route.ts
├── lib/
│   ├── comfyui.ts          # Client singleton
│   └── api-auth.ts         # Auth helpers
└── middleware.ts           # Rate limiting
```

---

## Testing

```bash
# Health check
curl http://localhost:3000/api/health

# Generate portrait (with auth cookie)
curl -X POST http://localhost:3000/api/generate/portrait \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=..." \
  -d '{"description": "Viking warrior"}'
```

---

## Summary

This API gateway pattern:
1. **Wraps** comfyui-mcp tools as HTTP endpoints
2. **Adds** auth, rate limiting, validation
3. **Returns** signed URLs for immediate client use
4. **Scales** via job queue for long generations

The comfyui-mcp package does the heavy lifting — the API layer just orchestrates and secures access.
