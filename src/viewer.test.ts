import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isHeadless,
  getDefaultViewOptions,
  parseViewFlags,
  getViewableUrl,
  formatUploadResult,
} from "./viewer.js";

describe("Viewer Utilities", () => {
  describe("isHeadless", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("returns true when FLY_APP_NAME is set", () => {
      process.env.FLY_APP_NAME = "my-app";
      delete process.env.DISPLAY;
      delete process.env.TERM_PROGRAM;
      expect(isHeadless()).toBe(true);
    });

    it("returns true when SSH_CONNECTION is set", () => {
      process.env.SSH_CONNECTION = "1.2.3.4 12345 5.6.7.8 22";
      delete process.env.DISPLAY;
      delete process.env.TERM_PROGRAM;
      expect(isHeadless()).toBe(true);
    });

    it("returns false when TERM_PROGRAM is set", () => {
      process.env.TERM_PROGRAM = "iTerm.app";
      delete process.env.SSH_CONNECTION;
      delete process.env.FLY_APP_NAME;
      expect(isHeadless()).toBe(false);
    });

    it("returns false when DISPLAY is set", () => {
      process.env.DISPLAY = ":0";
      delete process.env.SSH_CONNECTION;
      delete process.env.FLY_APP_NAME;
      expect(isHeadless()).toBe(false);
    });
  });

  describe("parseViewFlags", () => {
    it("parses --open flag", () => {
      const result = parseViewFlags(["--open"]);
      expect(result.autoOpen).toBe(true);
    });

    it("parses --no-open flag", () => {
      const result = parseViewFlags(["--no-open"]);
      expect(result.autoOpen).toBe(false);
    });

    it("parses --download flag", () => {
      const result = parseViewFlags(["--download"]);
      expect(result.download).toBe(true);
    });

    it("parses --no-download flag", () => {
      const result = parseViewFlags(["--no-download"]);
      expect(result.download).toBe(false);
    });

    it("parses --output=path flag", () => {
      const result = parseViewFlags(["--output=/custom/path"]);
      expect(result.downloadPath).toBe("/custom/path");
      expect(result.download).toBe(true);
    });

    it("parses multiple flags", () => {
      const result = parseViewFlags(["--open", "--no-download"]);
      expect(result.autoOpen).toBe(true);
      expect(result.download).toBe(false);
    });

    it("returns empty object for no flags", () => {
      const result = parseViewFlags([]);
      expect(result).toEqual({});
    });

    it("ignores unknown flags", () => {
      const result = parseViewFlags(["--unknown", "--foo=bar"]);
      expect(result).toEqual({});
    });
  });

  describe("getViewableUrl", () => {
    it("prefers signed URL over public URL", () => {
      const result = {
        path: "test.png",
        url: "https://public.url/test.png",
        signedUrl: "https://signed.url/test.png?token=abc",
        size: 1000,
      };
      expect(getViewableUrl(result)).toBe("https://signed.url/test.png?token=abc");
    });

    it("falls back to public URL when no signed URL", () => {
      const result = {
        path: "test.png",
        url: "https://public.url/test.png",
        size: 1000,
      };
      expect(getViewableUrl(result)).toBe("https://public.url/test.png");
    });

    it("returns null when no URLs available", () => {
      const result = {
        path: "test.png",
        url: null,
        size: 1000,
      };
      expect(getViewableUrl(result)).toBeNull();
    });
  });

  describe("formatUploadResult", () => {
    it("formats basic upload result", () => {
      const result = {
        path: "images/test.png",
        url: "https://example.com/test.png",
        size: 102400,
      };
      const formatted = formatUploadResult(result);
      expect(formatted).toContain("Path: images/test.png");
      expect(formatted).toContain("Size: 100.0 KB");
      expect(formatted).toContain("URL: https://example.com/test.png");
    });

    it("includes handle result info", () => {
      const result = {
        path: "images/test.png",
        url: "https://example.com/test.png",
        size: 102400,
      };
      const handleResult = {
        opened: true,
        downloaded: "/local/path/test.png",
      };
      const formatted = formatUploadResult(result, handleResult);
      expect(formatted).toContain("Opened in browser: Yes");
      expect(formatted).toContain("Downloaded to: /local/path/test.png");
    });
  });
});
