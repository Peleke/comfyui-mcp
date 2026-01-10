import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { upscaleImage, listUpscaleModels, upscaleSchema } from "./upscale.js";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  createMockFetch,
  mockHistoryUpscaleComplete,
  mockObjectInfo,
} from "../__mocks__/comfyui-responses.js";

// Mock the file system operations
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual("fs/promises");
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe("upscaleImage", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });

    vi.spyOn(client, "waitForCompletion").mockResolvedValue(
      mockHistoryUpscaleComplete["test-prompt-id-12345"]
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should upscale an image successfully", async () => {
    global.fetch = createMockFetch({
      history: mockHistoryUpscaleComplete,
    }) as typeof fetch;

    const result = await upscaleImage(client, {
      input_image: "input.png",
      output_path: "/tmp/test/upscaled.png",
      upscale_model: "RealESRGAN_x4plus.pth",
    });

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/test/upscaled.png");
    expect(result.message).toContain("upscaled");
  });

  it("should use default upscale model", async () => {
    global.fetch = createMockFetch({
      history: mockHistoryUpscaleComplete,
    }) as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await upscaleImage(client, {
      input_image: "input.png",
      output_path: "/tmp/test.png",
      upscale_model: "RealESRGAN_x4plus.pth",
    });

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["2"].inputs.model_name).toBe("RealESRGAN_x4plus.pth");
  });

  it("should use custom upscale model", async () => {
    global.fetch = createMockFetch({
      history: mockHistoryUpscaleComplete,
    }) as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await upscaleImage(client, {
      input_image: "input.png",
      output_path: "/tmp/test.png",
      upscale_model: "4x-UltraSharp.pth",
    });

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["2"].inputs.model_name).toBe("4x-UltraSharp.pth");
  });

  it("should set target dimensions when provided", async () => {
    global.fetch = createMockFetch({
      history: mockHistoryUpscaleComplete,
    }) as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await upscaleImage(client, {
      input_image: "input.png",
      output_path: "/tmp/test.png",
      upscale_model: "RealESRGAN_x4plus.pth",
      target_width: 2048,
      target_height: 2048,
    });

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["4"].inputs.width).toBe(2048);
    expect(calledWorkflow["4"].inputs.height).toBe(2048);
  });

  it("should remove resize node when no target dimensions", async () => {
    global.fetch = createMockFetch({
      history: mockHistoryUpscaleComplete,
    }) as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await upscaleImage(client, {
      input_image: "input.png",
      output_path: "/tmp/test.png",
      upscale_model: "RealESRGAN_x4plus.pth",
    });

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["4"]).toBeUndefined();
  });
});

describe("listUpscaleModels", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({ url: "http://localhost:8188" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should return list of upscale models", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const models = await listUpscaleModels(client);

    expect(models).toEqual(["RealESRGAN_x4plus.pth", "4x-UltraSharp.pth"]);
  });

  it("should return empty array if no models found", async () => {
    global.fetch = createMockFetch({
      objectInfo: {},
    }) as typeof fetch;

    const models = await listUpscaleModels(client);

    expect(models).toEqual([]);
  });
});

describe("upscaleSchema", () => {
  it("should validate valid input", () => {
    const input = {
      input_image: "input.png",
      output_path: "/tmp/upscaled.png",
    };

    const result = upscaleSchema.parse(input);

    expect(result.input_image).toBe("input.png");
    expect(result.output_path).toBe("/tmp/upscaled.png");
    expect(result.upscale_model).toBe("RealESRGAN_x4plus.pth"); // default
  });

  it("should reject missing input_image", () => {
    expect(() =>
      upscaleSchema.parse({
        output_path: "/tmp/test.png",
      })
    ).toThrow();
  });

  it("should reject missing output_path", () => {
    expect(() =>
      upscaleSchema.parse({
        input_image: "input.png",
      })
    ).toThrow();
  });

  it("should accept optional target dimensions", () => {
    const input = {
      input_image: "input.png",
      output_path: "/tmp/test.png",
      target_width: 2048,
      target_height: 2048,
    };

    const result = upscaleSchema.parse(input);

    expect(result.target_width).toBe(2048);
    expect(result.target_height).toBe(2048);
  });
});
