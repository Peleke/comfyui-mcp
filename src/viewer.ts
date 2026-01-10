/**
 * Viewer Utilities
 *
 * Handles viewing and downloading generated assets:
 * - Auto-open in browser (desktop)
 * - Download to local filesystem
 * - Environment-aware defaults (headless vs desktop)
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import {
  UploadResult,
  ViewOptions,
  isHeadless,
  getDefaultViewOptions,
} from "./storage/provider.js";

const execAsync = promisify(exec);

// Re-export for convenience
export { ViewOptions, isHeadless, getDefaultViewOptions };

/**
 * Open a URL in the default browser
 * Works on macOS, Linux, and Windows
 */
export async function openInBrowser(url: string): Promise<boolean> {
  if (isHeadless()) {
    return false;
  }

  const platform = process.platform;
  let command: string;

  switch (platform) {
    case "darwin":
      command = `open "${url}"`;
      break;
    case "win32":
      command = `start "" "${url}"`;
      break;
    default:
      // Linux - try xdg-open, then fallback to sensible-browser
      command = `xdg-open "${url}" || sensible-browser "${url}"`;
  }

  try {
    await execAsync(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download a file from URL to local path
 */
export async function downloadFile(
  url: string,
  localPath: string
): Promise<string> {
  // Ensure directory exists
  await fs.mkdir(path.dirname(localPath), { recursive: true });

  // Use fetch to download
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(localPath, buffer);

  return localPath;
}

/**
 * Get the best viewable URL from an upload result
 * Prefers signed URL for private buckets
 */
export function getViewableUrl(result: UploadResult): string | null {
  return result.signedUrl || result.url;
}

/**
 * Handle viewing/downloading after upload
 * Returns info about what was done
 */
export async function handleUploadResult(
  result: UploadResult,
  options?: Partial<ViewOptions>
): Promise<{
  url: string | null;
  opened: boolean;
  downloaded: string | null;
}> {
  const opts = { ...getDefaultViewOptions(), ...options };
  const url = getViewableUrl(result);

  let opened = false;
  let downloaded: string | null = null;

  // Auto-open in browser
  if (opts.autoOpen && url) {
    opened = await openInBrowser(url);
  }

  // Download to local path
  if (opts.download && url && opts.downloadPath) {
    const filename = path.basename(result.path);
    const localPath = path.join(opts.downloadPath, filename);
    downloaded = await downloadFile(url, localPath);
  }

  return { url, opened, downloaded };
}

/**
 * Parse CLI flags for view options
 * Supports: --open, --no-open, --download, --no-download, --output=path
 */
export function parseViewFlags(args: string[]): Partial<ViewOptions> {
  const options: Partial<ViewOptions> = {};

  for (const arg of args) {
    if (arg === "--open") {
      options.autoOpen = true;
    } else if (arg === "--no-open") {
      options.autoOpen = false;
    } else if (arg === "--download") {
      options.download = true;
    } else if (arg === "--no-download") {
      options.download = false;
    } else if (arg.startsWith("--output=")) {
      options.downloadPath = arg.slice("--output=".length);
      options.download = true;
    }
  }

  return options;
}

/**
 * Format upload result for display
 */
export function formatUploadResult(
  result: UploadResult,
  handleResult?: { opened: boolean; downloaded: string | null }
): string {
  const lines: string[] = [];
  const url = getViewableUrl(result);

  lines.push(`Path: ${result.path}`);
  lines.push(`Size: ${(result.size / 1024).toFixed(1)} KB`);

  if (url) {
    lines.push(`URL: ${url}`);
  }

  if (handleResult?.opened) {
    lines.push(`Opened in browser: Yes`);
  }

  if (handleResult?.downloaded) {
    lines.push(`Downloaded to: ${handleResult.downloaded}`);
  }

  return lines.join("\n");
}
