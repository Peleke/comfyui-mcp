import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateWithControlNet,
  generateWithMultiControlNet,
  preprocessControlImage,
  generateWithHiddenImage,
  stylizePhoto,
  generateWithPose,
  generateWithComposition,
  listControlNetModels,
  generateWithControlNetSchema,
  generateWithMultiControlNetSchema,
  preprocessControlImageSchema,
  generateWithHiddenImageSchema,
  stylizePhotoSchema,
  generateWithPoseSchema,
  generateWithCompositionSchema,
} from "./controlnet.js";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  createMockFetch,
  mockHistoryComplete,
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

describe("generateWithControlNet", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });

    vi.spyOn(client, "waitForCompletion").mockResolvedValue(
      mockHistoryComplete["test-prompt-id-12345"]
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should generate an image with ControlNet successfully", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const result = await generateWithControlNet(
      client,
      {
        prompt: "a beautiful portrait",
        control_image: "edges.png",
        control_type: "canny",
        output_path: "/tmp/test/controlnet_output.png",
        strength: 0.8,
        start_percent: 0.0,
        end_percent: 1.0,
        preprocess: true,
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "dreamshaper_8.safetensors"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/test/controlnet_output.png");
    expect(typeof result.seed).toBe("number");
    expect(result.message).toContain("canny ControlNet");
  });

  it("should use provided ControlNet model", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateWithControlNet(
      client,
      {
        prompt: "test",
        control_image: "depth.png",
        control_type: "depth",
        controlnet_model: "control_v11p_sd15_depth_fp16.safetensors",
        output_path: "/tmp/test.png",
        strength: 1.0,
        start_percent: 0.0,
        end_percent: 1.0,
        preprocess: true,
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["11"].inputs.control_net_name).toBe(
      "control_v11p_sd15_depth_fp16.safetensors"
    );
  });

  it("should set ControlNet strength correctly", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateWithControlNet(
      client,
      {
        prompt: "test",
        control_image: "pose.png",
        control_type: "openpose",
        output_path: "/tmp/test.png",
        strength: 0.65,
        start_percent: 0.0,
        end_percent: 1.0,
        preprocess: false,
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["14"].inputs.strength).toBe(0.65);
  });

  it("should add preprocessor node when preprocess is true", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateWithControlNet(
      client,
      {
        prompt: "test",
        control_image: "photo.png",
        control_type: "canny",
        output_path: "/tmp/test.png",
        strength: 1.0,
        start_percent: 0.0,
        end_percent: 1.0,
        preprocess: true,
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    // Preprocessor node should exist
    expect(calledWorkflow["20"]).toBeDefined();
    expect(calledWorkflow["20"].class_type).toBe("Canny");
  });

  it("should not add preprocessor for qrcode type", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateWithControlNet(
      client,
      {
        prompt: "test",
        control_image: "qr.png",
        control_type: "qrcode",
        output_path: "/tmp/test.png",
        strength: 1.0,
        start_percent: 0.0,
        end_percent: 1.0,
        preprocess: true,
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    // No preprocessor for QR code
    expect(calledWorkflow["20"]).toBeUndefined();
  });

  it("should throw error when no model specified and no default", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    await expect(
      generateWithControlNet(
        client,
        {
          prompt: "test",
          control_image: "edges.png",
          control_type: "canny",
          output_path: "/tmp/test.png",
          strength: 1.0,
          start_percent: 0.0,
          end_percent: 1.0,
          preprocess: true,
          width: 512,
          height: 768,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        ""
      )
    ).rejects.toThrow("No model specified and COMFYUI_MODEL not set");
  });
});

describe("generateWithMultiControlNet", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });

    vi.spyOn(client, "waitForCompletion").mockResolvedValue(
      mockHistoryComplete["test-prompt-id-12345"]
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should generate with multiple ControlNets", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const result = await generateWithMultiControlNet(
      client,
      {
        controls: [
          { type: "canny", image: "edges.png", strength: 0.8, start_percent: 0.0, end_percent: 1.0 },
          { type: "depth", image: "depth.png", strength: 0.6, start_percent: 0.0, end_percent: 1.0 },
        ],
        prompt: "a portrait",
        output_path: "/tmp/test/multi_output.png",
        preprocess: true,
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "dreamshaper_8.safetensors"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/test/multi_output.png");
    expect(result.control_types).toContain("canny");
    expect(result.control_types).toContain("depth");
  });

  it("should chain multiple ControlNet nodes correctly", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateWithMultiControlNet(
      client,
      {
        prompt: "test",
        controls: [
          { type: "canny", image: "edges.png", strength: 1.0, start_percent: 0.0, end_percent: 1.0 },
          { type: "openpose", image: "pose.png", strength: 0.8, start_percent: 0.0, end_percent: 1.0 },
        ],
        output_path: "/tmp/test.png",
        preprocess: false,
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    // Two ControlNet chains
    expect(calledWorkflow["cn_apply_0"]).toBeDefined();
    expect(calledWorkflow["cn_apply_1"]).toBeDefined();
    // Second should reference first's output
    expect(calledWorkflow["cn_apply_1"].inputs.positive[0]).toBe("cn_apply_0");
  });

  it("should throw error when no control nets provided", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    await expect(
      generateWithMultiControlNet(
        client,
        {
          prompt: "test",
          controls: [],
          output_path: "/tmp/test.png",
          preprocess: true,
          width: 512,
          height: 768,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      )
    ).rejects.toThrow("At least one ControlNet configuration is required");
  });
});

describe("generateWithHiddenImage", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });

    vi.spyOn(client, "waitForCompletion").mockResolvedValue(
      mockHistoryComplete["test-prompt-id-12345"]
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should generate with QR Code ControlNet", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const result = await generateWithHiddenImage(
      client,
      {
        prompt: "beautiful landscape",
        hidden_image: "qrcode.png",
        output_path: "/tmp/test/hidden_output.png",
        visibility: "subtle",
        width: 768,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "dreamshaper_8.safetensors"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/test/hidden_output.png");
  });

  it("should use qrcode control type", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateWithHiddenImage(
      client,
      {
        prompt: "test",
        hidden_image: "qr.png",
        output_path: "/tmp/test.png",
        visibility: "subtle",
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["10"].inputs.image).toBe("qr.png");
    // No preprocessor for QR code
    expect(calledWorkflow["20"]).toBeUndefined();
  });

  describe("visibility strength mapping", () => {
    it("should use strength 0.9 for subtle visibility", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithHiddenImage(
        client,
        {
          prompt: "test",
          hidden_image: "qr.png",
          output_path: "/tmp/test.png",
          visibility: "subtle",
          width: 512,
          height: 768,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["14"].inputs.strength).toBe(0.9);
    });

    it("should use strength 1.1 for moderate visibility", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithHiddenImage(
        client,
        {
          prompt: "test",
          hidden_image: "qr.png",
          output_path: "/tmp/test.png",
          visibility: "moderate",
          width: 512,
          height: 768,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["14"].inputs.strength).toBe(1.1);
    });

    it("should use strength 1.3 for obvious visibility", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithHiddenImage(
        client,
        {
          prompt: "test",
          hidden_image: "qr.png",
          output_path: "/tmp/test.png",
          visibility: "obvious",
          width: 512,
          height: 768,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["14"].inputs.strength).toBe(1.3);
    });
  });

  describe("QR ControlNet model selection by architecture", () => {
    it("should use SD1.5 QR ControlNet for SD1.5 models", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithHiddenImage(
        client,
        {
          prompt: "test",
          hidden_image: "logo.png",
          output_path: "/tmp/test.png",
          visibility: "subtle",
          width: 512,
          height: 768,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "v1-5-pruned.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["11"].inputs.control_net_name).toBe(
        "control_v1p_sd15_qrcode.safetensors"
      );
    });

    it("should use QR Code Monster SDXL for SDXL models", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithHiddenImage(
        client,
        {
          prompt: "test",
          hidden_image: "logo.png",
          output_path: "/tmp/test.png",
          visibility: "subtle",
          width: 1024,
          height: 1024,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "sdxl_base_1.0.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["11"].inputs.control_net_name).toBe(
        "qrCodeMonsterSDXL_v10.safetensors"
      );
    });

    it("should use QR Code Monster SDXL for Pony models", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithHiddenImage(
        client,
        {
          prompt: "test",
          hidden_image: "logo.png",
          output_path: "/tmp/test.png",
          visibility: "moderate",
          width: 1024,
          height: 1024,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "ponyDiffusionV6XL.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["11"].inputs.control_net_name).toBe(
        "qrCodeMonsterSDXL_v10.safetensors"
      );
    });

    it("should use QR Code Monster SDXL for furry models", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithHiddenImage(
        client,
        {
          prompt: "test",
          hidden_image: "logo.png",
          output_path: "/tmp/test.png",
          visibility: "obvious",
          width: 1024,
          height: 1024,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "novaFurryXL_v1.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["11"].inputs.control_net_name).toBe(
        "qrCodeMonsterSDXL_v10.safetensors"
      );
    });

    it("should use QR Code Monster SDXL for Illustrious models", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithHiddenImage(
        client,
        {
          prompt: "test",
          hidden_image: "logo.png",
          output_path: "/tmp/test.png",
          visibility: "subtle",
          width: 1024,
          height: 1024,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "illustriousXL_v1.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["11"].inputs.control_net_name).toBe(
        "qrCodeMonsterSDXL_v10.safetensors"
      );
    });
  });

  describe("hidden image input handling", () => {
    it("should never apply preprocessing to hidden images", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      // Even with preprocess typically true, hidden images skip preprocessing
      await generateWithHiddenImage(
        client,
        {
          prompt: "test",
          hidden_image: "company_logo.png",
          output_path: "/tmp/test.png",
          visibility: "subtle",
          width: 512,
          height: 768,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      // Preprocessor node (20) should not exist
      expect(calledWorkflow["20"]).toBeUndefined();
      // Image loader should directly use the hidden image
      expect(calledWorkflow["10"].inputs.image).toBe("company_logo.png");
    });

    it("should use full ControlNet application range (0-100%)", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithHiddenImage(
        client,
        {
          prompt: "test",
          hidden_image: "qr.png",
          output_path: "/tmp/test.png",
          visibility: "subtle",
          width: 512,
          height: 768,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["14"].inputs.start_percent).toBe(0.0);
      expect(calledWorkflow["14"].inputs.end_percent).toBe(1.0);
    });
  });
});

describe("stylizePhoto", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });

    vi.spyOn(client, "waitForCompletion").mockResolvedValue(
      mockHistoryComplete["test-prompt-id-12345"]
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should stylize photo with anime style", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const result = await stylizePhoto(
      client,
      {
        source_image: "portrait.jpg",
        style: "anime",
        output_path: "/tmp/test/stylized.png",
        preserve_detail: "medium",
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "dreamshaper_8.safetensors"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/test/stylized.png");
  });

  it("should add preprocessor for sketch style", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await stylizePhoto(
      client,
      {
        source_image: "photo.jpg",
        style: "sketch",
        output_path: "/tmp/test.png",
        preserve_detail: "medium",
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    // Should have preprocessor
    expect(calledWorkflow["20"]).toBeDefined();
  });
});

describe("generateWithPose", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });

    vi.spyOn(client, "waitForCompletion").mockResolvedValue(
      mockHistoryComplete["test-prompt-id-12345"]
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should generate with OpenPose ControlNet", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const result = await generateWithPose(
      client,
      {
        prompt: "a dancer",
        pose_reference: "pose.png",
        output_path: "/tmp/test/pose_output.png",
        copy_face: true,
        copy_hands: true,
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "dreamshaper_8.safetensors"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/test/pose_output.png");
  });

  it("should use DWPreprocessor for OpenPose", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateWithPose(
      client,
      {
        prompt: "test",
        pose_reference: "pose.jpg",
        output_path: "/tmp/test.png",
        copy_face: true,
        copy_hands: true,
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["20"]).toBeDefined();
    expect(calledWorkflow["20"].class_type).toBe("DWPreprocessor");
  });
});

describe("generateWithComposition", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });

    vi.spyOn(client, "waitForCompletion").mockResolvedValue(
      mockHistoryComplete["test-prompt-id-12345"]
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should generate with semantic segmentation ControlNet", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const result = await generateWithComposition(
      client,
      {
        prompt: "a beautiful scene",
        composition_reference: "segmap.png",
        output_path: "/tmp/test/composition_output.png",
        strength: 0.7,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "dreamshaper_8.safetensors"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/test/composition_output.png");
  });

  it("should use OneFormer preprocessor for semantic seg", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateWithComposition(
      client,
      {
        prompt: "test",
        composition_reference: "layout.jpg",
        output_path: "/tmp/test.png",
        strength: 0.7,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["20"]).toBeDefined();
    expect(calledWorkflow["20"].class_type).toBe(
      "UniFormer-SemSegPreprocessor"
    );
  });
});

describe("listControlNetModels", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should list all ControlNet models categorized by type", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const result = await listControlNetModels(client);

    expect(result).toBeDefined();
    expect(result.canny).toBeDefined();
    expect(result.canny).toContain("control_v11p_sd15_canny_fp16.safetensors");
  });

  it("should categorize depth models correctly", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const result = await listControlNetModels(client);

    expect(result.depth).toBeDefined();
    result.depth.forEach((model: string) => {
      expect(model.toLowerCase()).toContain("depth");
    });
  });
});

describe("generateWithControlNetSchema", () => {
  it("should validate valid input", () => {
    const input = {
      prompt: "test prompt",
      control_image: "edges.png",
      control_type: "canny",
      output_path: "/tmp/test.png",
    };

    const result = generateWithControlNetSchema.parse(input);

    expect(result.prompt).toBe("test prompt");
    expect(result.control_type).toBe("canny");
    expect(result.start_percent).toBe(0.0); // default
    expect(result.end_percent).toBe(1.0); // default
    expect(result.preprocess).toBe(true); // default
  });

  it("should reject invalid control_type", () => {
    expect(() =>
      generateWithControlNetSchema.parse({
        prompt: "test",
        control_image: "test.png",
        control_type: "invalid_type",
        output_path: "/tmp/test.png",
      })
    ).toThrow();
  });

  it("should reject missing required fields", () => {
    expect(() =>
      generateWithControlNetSchema.parse({
        prompt: "test",
        output_path: "/tmp/test.png",
      })
    ).toThrow();
  });

  it("should accept all valid control types", () => {
    const types = [
      "canny",
      "depth",
      "openpose",
      "qrcode",
      "scribble",
      "lineart",
      "semantic_seg",
    ];

    types.forEach((type) => {
      const result = generateWithControlNetSchema.parse({
        prompt: "test",
        control_image: "test.png",
        control_type: type,
        output_path: "/tmp/test.png",
      });
      expect(result.control_type).toBe(type);
    });
  });
});

describe("generateWithMultiControlNetSchema", () => {
  it("should validate valid input", () => {
    const input = {
      prompt: "test",
      controls: [
        { type: "canny", image: "edges.png" },
        { type: "depth", image: "depth.png", strength: 0.5 },
      ],
      output_path: "/tmp/test.png",
    };

    const result = generateWithMultiControlNetSchema.parse(input);

    expect(result.controls).toHaveLength(2);
    expect(result.controls[1].strength).toBe(0.5);
  });

  it("should reject empty controls array", () => {
    expect(() =>
      generateWithMultiControlNetSchema.parse({
        prompt: "test",
        controls: [],
        output_path: "/tmp/test.png",
      })
    ).toThrow();
  });
});

describe("preprocessControlImageSchema", () => {
  it("should validate valid input", () => {
    const input = {
      input_image: "photo.jpg",
      control_type: "canny",
      output_path: "/tmp/preprocessed.png",
    };

    const result = preprocessControlImageSchema.parse(input);

    expect(result.control_type).toBe("canny");
  });

  it("should accept preprocessor options", () => {
    const input = {
      input_image: "photo.jpg",
      control_type: "canny",
      output_path: "/tmp/preprocessed.png",
      preprocessor_options: {
        low_threshold: 50,
        high_threshold: 150,
      },
    };

    const result = preprocessControlImageSchema.parse(input);

    expect(result.preprocessor_options?.low_threshold).toBe(50);
    expect(result.preprocessor_options?.high_threshold).toBe(150);
  });
});

describe("generateWithHiddenImageSchema", () => {
  it("should validate valid input", () => {
    const input = {
      prompt: "landscape",
      hidden_image: "qrcode.png",
      output_path: "/tmp/hidden.png",
    };

    const result = generateWithHiddenImageSchema.parse(input);

    expect(result.visibility).toBe("subtle"); // default
  });
});

describe("stylizePhotoSchema", () => {
  it("should validate valid input with anime style", () => {
    const input = {
      source_image: "photo.jpg",
      style: "anime",
      output_path: "/tmp/stylized.png",
    };

    const result = stylizePhotoSchema.parse(input);

    expect(result.style).toBe("anime");
    expect(result.preserve_detail).toBe("medium"); // default
  });

  it("should validate valid input with sketch style", () => {
    const input = {
      source_image: "photo.jpg",
      style: "sketch",
      output_path: "/tmp/stylized.png",
    };

    const result = stylizePhotoSchema.parse(input);

    expect(result.style).toBe("sketch");
  });

  it("should reject invalid style", () => {
    expect(() =>
      stylizePhotoSchema.parse({
        source_image: "photo.jpg",
        style: "invalid_style",
        output_path: "/tmp/test.png",
      })
    ).toThrow();
  });
});

describe("generateWithPoseSchema", () => {
  it("should validate valid input", () => {
    const input = {
      prompt: "dancer",
      pose_reference: "pose.png",
      output_path: "/tmp/pose.png",
    };

    const result = generateWithPoseSchema.parse(input);

    expect(result.copy_face).toBe(true); // default
    expect(result.copy_hands).toBe(true); // default
  });

  it("should accept copy options", () => {
    const input = {
      prompt: "dancer",
      pose_reference: "pose.png",
      output_path: "/tmp/pose.png",
      copy_face: false,
      copy_hands: false,
    };

    const result = generateWithPoseSchema.parse(input);

    expect(result.copy_face).toBe(false);
    expect(result.copy_hands).toBe(false);
  });
});

describe("generateWithCompositionSchema", () => {
  it("should validate valid input", () => {
    const input = {
      prompt: "scene",
      composition_reference: "layout.png",
      output_path: "/tmp/composition.png",
    };

    const result = generateWithCompositionSchema.parse(input);

    expect(result.strength).toBe(0.7); // default for semantic seg
  });
});
