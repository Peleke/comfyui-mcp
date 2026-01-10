import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkConnection,
  pingComfyUI,
  checkConnectionSchema,
  HealthCheckResult,
} from "./health.js";
import { ComfyUIClient } from "../comfyui-client.js";
import * as storageModule from "../storage/index.js";

// Mock storage module
vi.mock("../storage/index.js", () => ({
  isCloudStorageConfigured: vi.fn().mockReturnValue(false),
  getStorageProvider: vi.fn(),
}));

// Mock ComfyUIClient
const createMockClient = (overrides: Partial<ComfyUIClient> = {}) =>
  ({
    baseUrl: "http://localhost:8188",
    wsUrl: "ws://localhost:8188",
    outputDir: "/tmp/comfyui-output",
    getSystemStats: vi.fn().mockResolvedValue({
      devices: [
        {
          name: "NVIDIA RTX 4090",
          type: "cuda",
          index: 0,
          vram_total: 25769803776, // 24GB
          vram_free: 20000000000,
          torch_vram_total: 25769803776,
          torch_vram_free: 18000000000,
        },
      ],
      system: {
        os: "linux",
        python_version: "3.10.12",
        comfyui_version: "0.2.0",
      },
    }),
    ...overrides,
  }) as unknown as ComfyUIClient;

describe("Health Check Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
  });

  describe("checkConnectionSchema", () => {
    it("validates empty object", () => {
      const result = checkConnectionSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("checkConnection", () => {
    it("returns healthy status when ComfyUI is reachable", async () => {
      const client = createMockClient();

      const result = await checkConnection({}, client);

      expect(result.comfyui.status).toBe("ok");
      expect(result.comfyui.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.comfyui.error).toBeUndefined();
    });

    it("extracts GPU information from system stats", async () => {
      const client = createMockClient();

      const result = await checkConnection({}, client);

      expect(result.gpu).toBeDefined();
      expect(result.gpu?.name).toBe("NVIDIA RTX 4090");
      expect(result.gpu?.vram_total_mb).toBe(24576); // ~24GB in MB
      expect(result.gpu?.vram_free_mb).toBeGreaterThan(0);
    });

    it("extracts system information", async () => {
      const client = createMockClient();

      const result = await checkConnection({}, client);

      expect(result.system).toBeDefined();
      expect(result.system?.os).toBe("linux");
      expect(result.system?.python_version).toBe("3.10.12");
      expect(result.system?.comfyui_version).toBe("0.2.0");
    });

    it("handles ComfyUI connection failure", async () => {
      const client = createMockClient({
        getSystemStats: vi.fn().mockRejectedValue(new Error("Connection refused")),
      });

      const result = await checkConnection({}, client);

      expect(result.comfyui.status).toBe("error");
      expect(result.comfyui.error).toContain("Connection refused");
      expect(result.gpu).toBeUndefined();
    });

    it("handles missing GPU in system stats", async () => {
      const client = createMockClient({
        getSystemStats: vi.fn().mockResolvedValue({
          devices: [],
          system: { os: "linux" },
        }),
      });

      const result = await checkConnection({}, client);

      expect(result.comfyui.status).toBe("ok");
      expect(result.gpu).toBeUndefined();
    });

    it("reports local storage as OK when not configured", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
      const client = createMockClient();

      const result = await checkConnection({}, client);

      expect(result.storage.status).toBe("ok");
      expect(result.storage.provider).toBe("local");
    });

    it("checks cloud storage health when configured", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      vi.mocked(storageModule.getStorageProvider).mockReturnValue({
        healthCheck: vi.fn().mockResolvedValue({ ok: true }),
      } as any);
      process.env.STORAGE_PROVIDER = "supabase";

      const client = createMockClient();
      const result = await checkConnection({}, client);

      expect(result.storage.status).toBe("ok");
      expect(result.storage.provider).toBe("supabase");

      delete process.env.STORAGE_PROVIDER;
    });

    it("reports cloud storage errors", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      vi.mocked(storageModule.getStorageProvider).mockReturnValue({
        healthCheck: vi.fn().mockResolvedValue({ ok: false, error: "Invalid credentials" }),
      } as any);
      process.env.STORAGE_PROVIDER = "supabase";

      const client = createMockClient();
      const result = await checkConnection({}, client);

      expect(result.storage.status).toBe("error");
      expect(result.storage.error).toBe("Invalid credentials");

      delete process.env.STORAGE_PROVIDER;
    });

    it("handles storage provider throwing", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      vi.mocked(storageModule.getStorageProvider).mockImplementation(() => {
        throw new Error("Provider not configured");
      });

      const client = createMockClient();
      const result = await checkConnection({}, client);

      expect(result.storage.status).toBe("error");
      expect(result.storage.error).toContain("Provider not configured");
    });

    it("measures latency accurately", async () => {
      const client = createMockClient({
        getSystemStats: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 50));
          return { devices: [], system: {} };
        }),
      });

      const result = await checkConnection({}, client);

      expect(result.comfyui.latency_ms).toBeGreaterThanOrEqual(50);
      expect(result.comfyui.latency_ms).toBeLessThan(200); // reasonable upper bound
    });
  });

  describe("pingComfyUI", () => {
    it("returns reachable true when ComfyUI responds", async () => {
      const client = createMockClient();

      const result = await pingComfyUI(client);

      expect(result.reachable).toBe(true);
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("returns reachable false on connection failure", async () => {
      const client = createMockClient({
        getSystemStats: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      });

      const result = await pingComfyUI(client);

      expect(result.reachable).toBe(false);
      expect(result.latency_ms).toBeUndefined();
      expect(result.error).toContain("ECONNREFUSED");
    });

    it("returns reachable false on timeout", async () => {
      const client = createMockClient({
        getSystemStats: vi.fn().mockRejectedValue(new Error("Timeout")),
      });

      const result = await pingComfyUI(client);

      expect(result.reachable).toBe(false);
      expect(result.error).toContain("Timeout");
    });
  });

  describe("Result Structure", () => {
    it("always includes required fields", async () => {
      const client = createMockClient();

      const result = await checkConnection({}, client);

      // Required fields must exist
      expect(result).toHaveProperty("comfyui");
      expect(result).toHaveProperty("storage");
      expect(result.comfyui).toHaveProperty("status");
      expect(result.storage).toHaveProperty("status");
      expect(result.storage).toHaveProperty("provider");
    });

    it("does not expose sensitive data", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      vi.mocked(storageModule.getStorageProvider).mockReturnValue({
        healthCheck: vi.fn().mockResolvedValue({ ok: true }),
      } as any);
      process.env.STORAGE_PROVIDER = "supabase";
      process.env.SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret";

      const client = createMockClient();
      const result = await checkConnection({}, client);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("eyJ"); // No JWT tokens
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("SUPABASE_SERVICE_KEY");

      delete process.env.STORAGE_PROVIDER;
      delete process.env.SUPABASE_SERVICE_KEY;
    });

    it("result is JSON serializable", async () => {
      const client = createMockClient();

      const result = await checkConnection({}, client);

      expect(() => JSON.stringify(result)).not.toThrow();
      const parsed = JSON.parse(JSON.stringify(result));
      expect(parsed.comfyui.status).toBe("ok");
    });
  });

  describe("Edge Cases", () => {
    it("handles null GPU values gracefully", async () => {
      const client = createMockClient({
        getSystemStats: vi.fn().mockResolvedValue({
          devices: [
            {
              name: null,
              vram_total: null,
              vram_free: null,
            },
          ],
          system: {},
        }),
      });

      const result = await checkConnection({}, client);

      expect(result.gpu).toBeDefined();
      expect(result.gpu?.name).toBe("Unknown GPU");
      expect(result.gpu?.vram_total_mb).toBe(0);
    });

    it("handles missing system info", async () => {
      const client = createMockClient({
        getSystemStats: vi.fn().mockResolvedValue({
          devices: [],
        }),
      });

      const result = await checkConnection({}, client);

      expect(result.system).toBeUndefined();
    });

    it("handles non-Error throws", async () => {
      const client = createMockClient({
        getSystemStats: vi.fn().mockRejectedValue("string error"),
      });

      const result = await checkConnection({}, client);

      expect(result.comfyui.status).toBe("error");
      expect(result.comfyui.error).toBe("string error");
    });
  });
});
