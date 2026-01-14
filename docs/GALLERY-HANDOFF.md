# Gallery Feature Handoff: landline-landing

## Context

The `comfyui-mcp` package generates images, audio, and video via ComfyUI on a RunPod GPU. Generated assets are uploaded to Supabase Storage (private bucket) and return signed URLs for viewing.

This handoff describes implementing a gallery component in **landline-landing** to browse and view generated assets.

---

## What comfyui-mcp Provides

### Upload Result Structure

When assets are generated and uploaded, the MCP tools return:

```typescript
interface UploadResult {
  path: string;       // Remote path: "portraits/viking-2024-01-10.png"
  url: string | null; // Public URL (null for private buckets)
  signedUrl?: string; // Signed URL (1 hour expiry, for private buckets)
  size: number;       // File size in bytes
}
```

### Storage Structure

Assets are organized in Supabase Storage:

```
generated-assets/           # Bucket name
├── portraits/              # Character portraits
│   └── {timestamp}-{seed}.png
├── speech/                 # TTS audio
│   └── {timestamp}.wav
├── videos/                 # Lip-sync videos
│   └── {timestamp}.mp4
└── e2e-tests/              # E2E test outputs
    └── e2e-test-{timestamp}.png
```

### Signed URL Generation

For private buckets, signed URLs are generated on upload:

```typescript
// From src/storage/supabase.ts
const { data: signedData } = await this.client.storage
  .from(this.bucket)
  .createSignedUrl(remotePath, 3600); // 1 hour expiry

return {
  path: data.path,
  url: urlData.publicUrl,
  signedUrl: signedData?.signedUrl,
  size: fileBuffer.length,
};
```

---

## Gallery Requirements

### Core Features

1. **List Assets** - Browse all generated assets by type (images, audio, video)
2. **Preview** - Display images inline, play audio/video
3. **Signed URL Refresh** - Re-generate expired signed URLs
4. **Download** - Allow downloading assets locally
5. **Delete** - Remove unwanted assets

### API Endpoints Needed

```typescript
// List assets in a folder
GET /api/gallery?folder=portraits&limit=50&cursor=...

// Get fresh signed URL for an asset
POST /api/gallery/sign
{ path: "portraits/viking-2024-01-10.png" }

// Delete an asset
DELETE /api/gallery
{ path: "portraits/viking-2024-01-10.png" }
```

### UI Components

1. **GalleryGrid** - Grid of thumbnails with lazy loading
2. **AssetPreview** - Modal for full-size preview
3. **MediaPlayer** - Audio/video playback for .wav/.mp4
4. **FolderNav** - Navigate between asset types

---

## Supabase Integration

### Environment Variables

```bash
SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_SERVICE_KEY="eyJ..."  # Server-side only
SUPABASE_ANON_KEY="eyJ..."     # Client-side (if needed)
SUPABASE_BUCKET="generated-assets"
```

### Server-Side Operations

Use service key for listing and signing:

```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// List files in folder
const { data, error } = await supabase.storage
  .from("generated-assets")
  .list("portraits", {
    limit: 50,
    offset: 0,
    sortBy: { column: "created_at", order: "desc" },
  });

// Generate signed URL
const { data: signedUrl } = await supabase.storage
  .from("generated-assets")
  .createSignedUrl("portraits/file.png", 3600);
```

### File Metadata

Supabase returns file objects:

```typescript
interface FileObject {
  name: string;           // "viking-2024-01-10.png"
  id: string;             // UUID
  created_at: string;     // ISO timestamp
  updated_at: string;
  last_accessed_at: string;
  metadata: {
    size: number;
    mimetype: string;
  };
}
```

---

## UI/UX Suggestions

### Gallery Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Gallery                              [Portraits ▼] [↻ Refresh]│
├─────────────────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │         │  │         │  │         │  │         │       │
│  │  img 1  │  │  img 2  │  │  img 3  │  │  img 4  │       │
│  │         │  │         │  │         │  │         │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
│  Jan 10, 12:34  Jan 10, 11:22  Jan 9, 15:00  Jan 9, 14:30  │
│                                                             │
│  ┌─────────┐  ┌─────────┐                                  │
│  │         │  │         │                                  │
│  │  img 5  │  │  img 6  │                                  │
│  │         │  │         │                                  │
│  └─────────┘  └─────────┘                                  │
│                                                             │
│  [Load More...]                                             │
└─────────────────────────────────────────────────────────────┘
```

### Asset Types

| Type | Extension | Preview | Actions |
|------|-----------|---------|---------|
| Image | .png, .jpg | Thumbnail + lightbox | Download, Delete |
| Audio | .wav, .mp3 | Waveform + play button | Play, Download, Delete |
| Video | .mp4 | Thumbnail + play overlay | Play, Download, Delete |

### Responsive Behavior

- Desktop: 4-column grid
- Tablet: 3-column grid
- Mobile: 2-column grid

---

## Implementation Notes

### Signed URL Caching

URLs expire after 1 hour. Options:

1. **Lazy refresh** - Regenerate URL when user clicks asset
2. **Preemptive refresh** - Track expiry, refresh before it expires
3. **Short cache** - Store signed URLs in memory for 50 minutes

### Pagination

Use cursor-based pagination with Supabase's `offset`:

```typescript
const PAGE_SIZE = 50;
const { data } = await supabase.storage
  .from(bucket)
  .list(folder, {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
```

### Error Handling

- **403 on signed URL**: URL expired, regenerate
- **404**: Asset deleted externally
- **Network errors**: Retry with exponential backoff

---

## Testing

### Manual Tests

1. Upload test image via comfyui-mcp E2E
2. Navigate to gallery in landline-landing
3. Verify image appears in grid
4. Click to preview full size
5. Wait 1 hour, verify URL refresh works
6. Test download functionality
7. Test delete functionality

### Integration Test

```typescript
describe("Gallery API", () => {
  it("lists assets in folder", async () => {
    const res = await fetch("/api/gallery?folder=portraits");
    const data = await res.json();
    expect(data.files).toBeInstanceOf(Array);
  });

  it("generates signed URL", async () => {
    const res = await fetch("/api/gallery/sign", {
      method: "POST",
      body: JSON.stringify({ path: "portraits/test.png" }),
    });
    const { signedUrl } = await res.json();
    expect(signedUrl).toMatch(/^https:\/\/.*\.supabase\.co/);
  });
});
```

---

## Files to Create in landline-landing

```
src/
├── app/
│   ├── gallery/
│   │   └── page.tsx          # Gallery page
│   └── api/
│       └── gallery/
│           ├── route.ts      # List assets
│           └── sign/
│               └── route.ts  # Generate signed URL
├── components/
│   └── gallery/
│       ├── GalleryGrid.tsx
│       ├── AssetCard.tsx
│       ├── AssetPreview.tsx
│       └── MediaPlayer.tsx
└── lib/
    └── supabase.ts           # Supabase client setup
```

---

## Summary

This gallery feature complements the comfyui-mcp pipeline by providing a visual interface to browse generated content. The key integration points are:

1. **Supabase Storage** - Same bucket used by comfyui-mcp uploads
2. **Signed URLs** - Required for private bucket access
3. **Asset metadata** - File names encode timestamp and seed for organization

The implementation is straightforward Next.js + Supabase with no special dependencies on comfyui-mcp itself.
