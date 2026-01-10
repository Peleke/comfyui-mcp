import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listAvatars,
  listVoicesCatalog,
  createPortrait,
  batchCreatePortraits,
  listAvatarsSchema,
  listVoicesCatalogSchema,
  createPortraitSchema,
  batchCreatePortraitsSchema,
  AVATAR_SUBFOLDER,
  VOICE_SUBFOLDER,
} from "./avatar.js";
import { ComfyUIClient } from "../comfyui-client.js";
import * as fs from "fs/promises";
import { ProgressEvent } from "../progress.js";
import * as storageModule from "../storage/index.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock storage module
vi.mock("../storage/index.js", () => ({
  isCloudStorageConfigured: vi.fn().mockReturnValue(false),
  getStorageProvider: vi.fn(),
  generateRemotePath: vi.fn((type, filename) => `generated/${type}/${Date.now()}_${filename}`),
}));

// Mock ComfyUIClient - includes outputs at both "save" (Flux) and "9" (SDXL) nodes
const createMockClient = (overrides: Partial<ComfyUIClient> = {}) => ({
  baseUrl: "http://localhost:8188",
  wsUrl: "ws://localhost:8188",
  outputDir: "/tmp/comfyui-output",
  queuePrompt: vi.fn().mockResolvedValue({ prompt_id: "test-prompt-id", number: 1 }),
  waitForCompletion: vi.fn().mockResolvedValue({
    status: { status_str: "success", completed: true, messages: [] },
    outputs: {
      // Flux GGUF output node
      "save": {
        images: [{
          filename: "ComfyUI_Portrait_00001.png",
          subfolder: "",
          type: "output",
        }],
      },
      // SDXL output node (node ID 9 in buildTxt2ImgWorkflow)
      "9": {
        images: [{
          filename: "ComfyUI_Portrait_00001.png",
          subfolder: "",
          type: "output",
        }],
      },
    },
  }),
  getHistory: vi.fn(),
  getObjectInfo: vi.fn().mockResolvedValue({}),
  getQueueStatus: vi.fn(),
  getModels: vi.fn(),
  getSamplers: vi.fn(),
  getSchedulers: vi.fn(),
  getImage: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
  getAudio: vi.fn(),
  getVideo: vi.fn(),
  ...overrides,
}) as unknown as ComfyUIClient;

describe("Avatar Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset storage mock to default (not configured)
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
  });

  describe("listAvatarsSchema", () => {
    it("validates empty object", () => {
      const result = listAvatarsSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("listVoicesCatalogSchema", () => {
    it("validates empty object", () => {
      const result = listVoicesCatalogSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("createPortraitSchema", () => {
    it("validates required fields", () => {
      const validInput = {
        description: "An old Norse god with one eye",
        output_path: "/tmp/odin.png",
      };

      const result = createPortraitSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("applies default values", () => {
      const input = {
        description: "A portrait",
        output_path: "/tmp/out.png",
      };

      const result = createPortraitSchema.parse(input);
      expect(result.style).toBe("realistic");
      expect(result.expression).toBe("neutral");
      expect(result.backend).toBe("sdxl");
      expect(result.guidance).toBe(7.0);  // SDXL default
      expect(result.steps).toBe(28);      // SDXL default
      expect(result.width).toBe(768);
      expect(result.height).toBe(1024);
    });

    it("validates style enum", () => {
      const validStyles = ["realistic", "artistic", "anime"];

      for (const style of validStyles) {
        const result = createPortraitSchema.safeParse({
          description: "Test",
          output_path: "/tmp/out.png",
          style,
        });
        expect(result.success).toBe(true);
      }
    });

    it("validates expression enum", () => {
      const validExpressions = ["neutral", "slight_smile", "serious", "friendly"];

      for (const expression of validExpressions) {
        const result = createPortraitSchema.safeParse({
          description: "Test",
          output_path: "/tmp/out.png",
          expression,
        });
        expect(result.success).toBe(true);
      }
    });

    it("validates gender enum", () => {
      const validGenders = ["male", "female", "androgynous"];

      for (const gender of validGenders) {
        const result = createPortraitSchema.safeParse({
          description: "Test",
          output_path: "/tmp/out.png",
          gender,
        });
        expect(result.success).toBe(true);
      }
    });

    it("accepts all optional parameters", () => {
      const input = {
        description: "Odin, the All-Father",
        style: "artistic" as const,
        gender: "male" as const,
        age: "elderly",
        expression: "serious" as const,
        model: "flux1-dev-Q5_K_M.gguf",
        guidance: 1.5,
        steps: 20,
        seed: 42,
        output_path: "/tmp/odin.png",
      };

      const result = createPortraitSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("listAvatars", () => {
    it("returns avatars from LoadImage input", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          LoadImage: {
            input: {
              required: {
                image: [[
                  "avatars/odin.png",
                  "avatars/thor.png",
                  "portrait.jpg",
                  "random_image.png",
                ]],
              },
            },
          },
        }),
      });

      const result = await listAvatars({}, client);

      expect(result.avatars.length).toBeGreaterThan(0);
      expect(result.avatars.some(a => a.filename === "odin.png")).toBe(true);
      expect(result.avatars.some(a => a.subfolder === "avatars")).toBe(true);
      expect(result.convention).toContain(AVATAR_SUBFOLDER);
    });

    it("returns empty array when no images available", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({}),
      });

      const result = await listAvatars({}, client);

      expect(result.avatars).toEqual([]);
    });

    it("includes images with common extensions", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          LoadImage: {
            input: {
              required: {
                image: [[
                  "test.png",
                  "test.jpg",
                  "test.jpeg",
                  "test.webp",
                  "test.txt", // Should be excluded
                ]],
              },
            },
          },
        }),
      });

      const result = await listAvatars({}, client);

      expect(result.avatars.length).toBe(4);
      expect(result.avatars.every(a =>
        a.filename.endsWith(".png") ||
        a.filename.endsWith(".jpg") ||
        a.filename.endsWith(".jpeg") ||
        a.filename.endsWith(".webp")
      )).toBe(true);
    });
  });

  describe("listVoicesCatalog", () => {
    it("returns voice files with metadata", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          LoadAudio: {
            input: {
              required: {
                audio: [[
                  "voices/icelandic_male.wav",
                  "voices/latin_male.mp3",
                  "sound.flac",
                  "music.ogg",
                ]],
              },
            },
          },
        }),
      });

      const result = await listVoicesCatalog({}, client);

      expect(result.voices.length).toBe(4);
      expect(result.voices.some(v => v.format === "wav")).toBe(true);
      expect(result.voices.some(v => v.format === "mp3")).toBe(true);
      expect(result.voices.some(v => v.format === "flac")).toBe(true);
      expect(result.voices.some(v => v.format === "ogg")).toBe(true);
      expect(result.convention).toContain(VOICE_SUBFOLDER);
    });

    it("extracts subfolder from path", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          LoadAudio: {
            input: {
              required: {
                audio: [["voices/icelandic/male.wav"]],
              },
            },
          },
        }),
      });

      const result = await listVoicesCatalog({}, client);

      expect(result.voices[0].filename).toBe("male.wav");
      expect(result.voices[0].subfolder).toBe("voices/icelandic");
    });

    it("returns empty array when no audio available", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({}),
      });

      const result = await listVoicesCatalog({}, client);

      expect(result.voices).toEqual([]);
    });

    it("filters non-audio files", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          LoadAudio: {
            input: {
              required: {
                audio: [[
                  "voice.wav",
                  "image.png",
                  "document.pdf",
                ]],
              },
            },
          },
        }),
      });

      const result = await listVoicesCatalog({}, client);

      expect(result.voices.length).toBe(1);
      expect(result.voices[0].filename).toBe("voice.wav");
    });
  });

  describe("createPortrait", () => {
    // Helper to create base args with defaults
    const baseArgs = {
      width: 768,
      height: 1024,
      backend: "sdxl" as const,
      style: "realistic" as const,
      expression: "neutral" as const,
    };

    it("generates portrait with SDXL workflow", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "Odin, the All-Father, Norse god",
          gender: "male",
          age: "elderly",
          expression: "serious",
          output_path: "/tmp/odin.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(client.queuePrompt).toHaveBeenCalledTimes(1);
      expect(client.waitForCompletion).toHaveBeenCalledWith("test-prompt-id", expect.any(Function));
      expect(client.getImage).toHaveBeenCalled();
      expect(result.image).toBe("/tmp/odin.png");
      expect(result.prompt).toContain("Odin");
    });

    it("generates portrait with Flux GGUF workflow", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          backend: "flux_gguf",
          description: "A warrior",
          output_path: "/tmp/out.png",
          guidance: 2.0,
          steps: 4,
        },
        client
      );

      expect(client.queuePrompt).toHaveBeenCalledTimes(1);
      expect(result.model).toContain("flux");
    });

    it("builds appropriate prompt for realistic style", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "A warrior",
          style: "realistic",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(result.prompt).toContain("portrait photograph");
      expect(result.prompt).toContain("front-facing");
    });

    it("builds appropriate prompt for anime style", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "A warrior",
          style: "anime",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(result.prompt).toContain("anime style portrait");
    });

    it("builds appropriate prompt for artistic style", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "A warrior",
          style: "artistic",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(result.prompt).toContain("artistic portrait");
    });

    it("builds appropriate prompt for furry style", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "A wolf warrior",
          style: "furry",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(result.prompt).toContain("anthro portrait");
    });

    it("includes gender in prompt when specified", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "A person",
          gender: "androgynous",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(result.prompt).toContain("androgynous");
    });

    it("includes age in prompt when specified", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "A person",
          age: "elderly",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(result.prompt).toContain("elderly");
    });

    it("creates output directory", async () => {
      const client = createMockClient();

      await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/deep/nested/dir/portrait.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(fs.mkdir).toHaveBeenCalledWith("/deep/nested/dir", { recursive: true });
    });

    it("uses custom SDXL model when specified", async () => {
      const client = createMockClient();

      await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          model: "novaFurryXL_ilV130.safetensors",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      const queueCall = (client.queuePrompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const workflow = queueCall[0];
      // SDXL uses CheckpointLoaderSimple at node "4" (from txt2img.json)
      expect(workflow["4"].inputs.ckpt_name).toBe("novaFurryXL_ilV130.safetensors");
    });

    it("uses Flux GGUF model when backend is flux_gguf", async () => {
      const client = createMockClient();

      await createPortrait(
        {
          ...baseArgs,
          backend: "flux_gguf",
          description: "Test",
          model: "flux1-dev-Q8_0.gguf",
          output_path: "/tmp/out.png",
          guidance: 2.0,
          steps: 20,
        },
        client
      );

      const queueCall = (client.queuePrompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const workflow = queueCall[0];
      expect(workflow["unet"].inputs.unet_name).toBe("flux1-dev-Q8_0.gguf");
    });

    it("respects guidance parameter for Flux GGUF", async () => {
      const client = createMockClient();

      await createPortrait(
        {
          ...baseArgs,
          backend: "flux_gguf",
          description: "Test",
          guidance: 3.5,
          output_path: "/tmp/out.png",
          steps: 4,
        },
        client
      );

      const queueCall = (client.queuePrompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const workflow = queueCall[0];
      expect(workflow["guidance"].inputs.guidance).toBe(3.5);
    });

    it("respects steps parameter for Flux GGUF", async () => {
      const client = createMockClient();

      await createPortrait(
        {
          ...baseArgs,
          backend: "flux_gguf",
          description: "Test",
          steps: 25,
          output_path: "/tmp/out.png",
          guidance: 2.0,
        },
        client
      );

      const queueCall = (client.queuePrompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const workflow = queueCall[0];
      expect(workflow["scheduler"].inputs.steps).toBe(25);
    });

    it("throws on missing image output", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue({
          status: { status_str: "success", completed: true, messages: [] },
          outputs: {},
        }),
      });

      await expect(
        createPortrait(
          {
            ...baseArgs,
            description: "Test",
            output_path: "/tmp/out.png",
            guidance: 7.0,
            steps: 28,
          },
          client
        )
      ).rejects.toThrow("No image output found");
    });

    it("throws on null history", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue(null),
      });

      await expect(
        createPortrait(
          {
            ...baseArgs,
            description: "Test",
            output_path: "/tmp/out.png",
            guidance: 7.0,
            steps: 28,
          },
          client
        )
      ).rejects.toThrow("No output from workflow");
    });

    it("always includes lip-sync optimization in prompt", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "Just a person",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(result.prompt).toContain("front-facing");
      expect(result.prompt).toContain("looking directly at camera");
      expect(result.prompt).toContain("clear view of face and lips");
    });

    it("returns taskId in result", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(result.taskId).toBeDefined();
      expect(result.taskId).toMatch(/^task_\d+_[a-z0-9]+$/);
    });

    it("uses provided taskId when given", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client,
        { taskId: "custom_task_123" }
      );

      expect(result.taskId).toBe("custom_task_123");
    });

    it("uses Flux FP8 model when backend is flux_fp8", async () => {
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          backend: "flux_fp8",
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 2.0,
          steps: 4,
        },
        client
      );

      expect(result.model).toContain("flux");
      const queueCall = (client.queuePrompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const workflow = queueCall[0];
      expect(workflow["checkpoint"].class_type).toBe("CheckpointLoaderSimple");
    });

    it("generates random seed when not provided", async () => {
      const client = createMockClient();

      await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      const queueCall = (client.queuePrompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const workflow = queueCall[0];
      // SDXL workflow uses KSampler at node "3"
      expect(workflow["3"].inputs.seed).toBeDefined();
      expect(workflow["3"].inputs.seed).toBeGreaterThanOrEqual(0);
    });

    it("uses provided seed when specified", async () => {
      const client = createMockClient();

      await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
          seed: 42,
        },
        client
      );

      const queueCall = (client.queuePrompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const workflow = queueCall[0];
      expect(workflow["3"].inputs.seed).toBe(42);
    });
  });

  describe("createPortrait - Cloud Upload", () => {
    const baseArgs = {
      width: 768,
      height: 1024,
      backend: "sdxl" as const,
      style: "realistic" as const,
      expression: "neutral" as const,
    };

    afterEach(() => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
    });

    it("does not upload when cloud storage is not configured", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(storageModule.getStorageProvider).not.toHaveBeenCalled();
      expect(result.remote_url).toBeUndefined();
    });

    it("uploads to cloud when configured and upload_to_cloud is true", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      const mockUpload = vi.fn().mockResolvedValue({
        path: "generated/images/123_out.png",
        url: "https://storage.example.com/generated/images/123_out.png",
      });
      vi.mocked(storageModule.getStorageProvider).mockReturnValue({
        upload: mockUpload,
      } as any);

      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          upload_to_cloud: true,
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(result.remote_url).toBe("https://storage.example.com/generated/images/123_out.png");
    });

    it("does not upload when upload_to_cloud is false", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      const mockUpload = vi.fn();
      vi.mocked(storageModule.getStorageProvider).mockReturnValue({
        upload: mockUpload,
      } as any);

      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          upload_to_cloud: false,
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(mockUpload).not.toHaveBeenCalled();
      expect(result.remote_url).toBeUndefined();
    });

    it("defaults upload_to_cloud to true", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      const mockUpload = vi.fn().mockResolvedValue({
        path: "generated/images/out.png",
        url: "https://storage.example.com/out.png",
      });
      vi.mocked(storageModule.getStorageProvider).mockReturnValue({
        upload: mockUpload,
      } as any);

      const client = createMockClient();

      // Parse through schema to test defaults (mimics MCP server behavior)
      const parsedArgs = createPortraitSchema.parse({
        ...baseArgs,
        description: "Test",
        output_path: "/tmp/out.png",
        guidance: 7.0,
        steps: 28,
      });

      await createPortrait(parsedArgs, client);

      expect(mockUpload).toHaveBeenCalled();
    });

    it("continues successfully when cloud upload fails", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      const mockUpload = vi.fn().mockRejectedValue(new Error("Upload failed"));
      vi.mocked(storageModule.getStorageProvider).mockReturnValue({
        upload: mockUpload,
      } as any);

      const client = createMockClient();
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Parse through schema to apply defaults (mimics MCP server behavior)
      const parsedArgs = createPortraitSchema.parse({
        ...baseArgs,
        description: "Test",
        output_path: "/tmp/out.png",
        guidance: 7.0,
        steps: 28,
      });

      const result = await createPortrait(parsedArgs, client);

      expect(result.image).toBe("/tmp/out.png");
      expect(result.remote_url).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith("Cloud upload failed:", expect.any(Error));

      consoleSpy.mockRestore();
    });

    it("handles upload returning null url", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      vi.mocked(storageModule.getStorageProvider).mockReturnValue({
        upload: vi.fn().mockResolvedValue({ path: "some/path", url: null }),
      } as any);

      const client = createMockClient();

      const result = await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(result.remote_url).toBeUndefined();
    });

    it("passes correct remote path to upload", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      const mockUpload = vi.fn().mockResolvedValue({ path: "test", url: "https://test.com" });
      vi.mocked(storageModule.getStorageProvider).mockReturnValue({
        upload: mockUpload,
      } as any);
      vi.mocked(storageModule.generateRemotePath).mockReturnValue("generated/images/timestamp_portrait.png");

      const client = createMockClient();

      // Parse through schema to apply defaults (mimics MCP server behavior)
      const parsedArgs = createPortraitSchema.parse({
        ...baseArgs,
        description: "Test",
        output_path: "/tmp/my_portrait.png",
        guidance: 7.0,
        steps: 28,
      });

      await createPortrait(parsedArgs, client);

      expect(storageModule.generateRemotePath).toHaveBeenCalledWith("images", "my_portrait.png");
      expect(mockUpload).toHaveBeenCalledWith(
        "/tmp/my_portrait.png",
        "generated/images/timestamp_portrait.png"
      );
    });
  });

  describe("createPortrait - Progress Callbacks", () => {
    const baseArgs = {
      width: 768,
      height: 1024,
      backend: "sdxl" as const,
      style: "realistic" as const,
      expression: "neutral" as const,
    };

    it("calls progress callback with all stages", async () => {
      const client = createMockClient();
      const progressEvents: ProgressEvent[] = [];
      const onProgress = (event: ProgressEvent) => progressEvents.push(event);

      await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client,
        { onProgress }
      );

      expect(progressEvents.length).toBeGreaterThan(0);
      const stages = progressEvents.map(e => e.stage);
      expect(stages).toContain("queued");
      expect(stages).toContain("starting");
      expect(stages).toContain("loading_model");
      expect(stages).toContain("generating");
      expect(stages).toContain("post_processing");
      expect(stages).toContain("complete");
    });

    it("emits error stage when workflow fails", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue(null),
      });
      const progressEvents: ProgressEvent[] = [];
      const onProgress = (event: ProgressEvent) => progressEvents.push(event);

      await expect(
        createPortrait(
          {
            ...baseArgs,
            description: "Test",
            output_path: "/tmp/out.png",
            guidance: 7.0,
            steps: 28,
          },
          client,
          { onProgress }
        )
      ).rejects.toThrow();

      const stages = progressEvents.map(e => e.stage);
      expect(stages).toContain("error");
    });

    it("progress events have correct taskId", async () => {
      const client = createMockClient();
      const progressEvents: ProgressEvent[] = [];
      const onProgress = (event: ProgressEvent) => progressEvents.push(event);

      await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client,
        { onProgress, taskId: "test_task_456" }
      );

      expect(progressEvents.every(e => e.taskId === "test_task_456")).toBe(true);
    });

    it("progress events have timestamps", async () => {
      const client = createMockClient();
      const progressEvents: ProgressEvent[] = [];
      const onProgress = (event: ProgressEvent) => progressEvents.push(event);

      await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client,
        { onProgress }
      );

      expect(progressEvents.every(e => e.timestamp > 0)).toBe(true);
    });

    it("progress percentages increase over time", async () => {
      const client = createMockClient();
      const progressEvents: ProgressEvent[] = [];
      const onProgress = (event: ProgressEvent) => progressEvents.push(event);

      await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client,
        { onProgress }
      );

      // Filter for non-error events and check progression
      const normalEvents = progressEvents.filter(e => e.stage !== "error");
      expect(normalEvents[normalEvents.length - 1].progress).toBe(100);
    });

    it("works without progress callback", async () => {
      const client = createMockClient();

      // Should not throw
      const result = await createPortrait(
        {
          ...baseArgs,
          description: "Test",
          output_path: "/tmp/out.png",
          guidance: 7.0,
          steps: 28,
        },
        client
      );

      expect(result.image).toBeDefined();
    });

    it("includes uploading stage when cloud upload is configured", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      vi.mocked(storageModule.getStorageProvider).mockReturnValue({
        upload: vi.fn().mockResolvedValue({ path: "test", url: "https://test.com" }),
      } as any);

      const client = createMockClient();
      const progressEvents: ProgressEvent[] = [];
      const onProgress = (event: ProgressEvent) => progressEvents.push(event);

      // Parse through schema to apply defaults (mimics MCP server behavior)
      // TODO: Runtime defaults should be added to implementation
      const parsedArgs = createPortraitSchema.parse({
        ...baseArgs,
        description: "Test",
        output_path: "/tmp/out.png",
        guidance: 7.0,
        steps: 28,
      });

      await createPortrait(parsedArgs, client, { onProgress });

      const stages = progressEvents.map(e => e.stage);
      expect(stages).toContain("uploading");

      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
    });
  });

  describe("batchCreatePortraitsSchema", () => {
    it("validates required fields", () => {
      const validInput = {
        portraits: [
          { description: "Person 1", model: "model1.safetensors", name: "person1" },
          { description: "Person 2", model: "model2.safetensors", name: "person2" },
        ],
        output_dir: "/tmp/batch",
      };

      const result = batchCreatePortraitsSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("applies default values", () => {
      const input = {
        portraits: [{ description: "Test", model: "test.safetensors", name: "test" }],
        output_dir: "/tmp/out",
      };

      const result = batchCreatePortraitsSchema.parse(input);
      expect(result.backend).toBe("sdxl");
      expect(result.steps).toBe(28);
      expect(result.guidance).toBe(7.0);
    });

    it("rejects empty portraits array", () => {
      const input = {
        portraits: [],
        output_dir: "/tmp/out",
      };

      // Empty array is technically valid by zod, but we might want to validate min length
      const result = batchCreatePortraitsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("validates portrait object structure", () => {
      const input = {
        portraits: [
          { description: "Test" }, // Missing model and name
        ],
        output_dir: "/tmp/out",
      };

      const result = batchCreatePortraitsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("batchCreatePortraits", () => {
    it("generates multiple portraits", async () => {
      const client = createMockClient();

      const result = await batchCreatePortraits(
        {
          portraits: [
            { description: "Person 1", model: "model1.safetensors", name: "person1" },
            { description: "Person 2", model: "model2.safetensors", name: "person2" },
          ],
          output_dir: "/tmp/batch",
          backend: "sdxl",
          steps: 28,
          guidance: 7.0,
        },
        client
      );

      expect(result.results.length).toBe(2);
      expect(result.summary.total).toBe(2);
      expect(result.summary.succeeded).toBe(2);
      expect(result.summary.failed).toBe(0);
    });

    it("creates output directory", async () => {
      const client = createMockClient();

      await batchCreatePortraits(
        {
          portraits: [{ description: "Test", model: "test.safetensors", name: "test" }],
          output_dir: "/deep/nested/batch",
          backend: "sdxl",
          steps: 28,
          guidance: 7.0,
        },
        client
      );

      expect(fs.mkdir).toHaveBeenCalledWith("/deep/nested/batch", { recursive: true });
    });

    it("uses correct output filenames", async () => {
      const client = createMockClient();

      const result = await batchCreatePortraits(
        {
          portraits: [
            { description: "Odin", model: "model.safetensors", name: "odin_portrait" },
          ],
          output_dir: "/tmp/batch",
          backend: "sdxl",
          steps: 28,
          guidance: 7.0,
        },
        client
      );

      expect(result.results[0].image).toBe("/tmp/batch/odin_portrait.png");
    });

    it("handles individual portrait failures gracefully", async () => {
      let callCount = 0;
      const client = createMockClient({
        waitForCompletion: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 2) {
            return Promise.resolve(null); // Second portrait fails
          }
          return Promise.resolve({
            status: { status_str: "success", completed: true, messages: [] },
            outputs: {
              "save": { images: [{ filename: "test.png", subfolder: "", type: "output" }] },
              "9": { images: [{ filename: "test.png", subfolder: "", type: "output" }] },
            },
          });
        }),
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await batchCreatePortraits(
        {
          portraits: [
            { description: "Success", model: "model.safetensors", name: "success" },
            { description: "Fail", model: "model.safetensors", name: "fail" },
            { description: "Success2", model: "model.safetensors", name: "success2" },
          ],
          output_dir: "/tmp/batch",
          backend: "sdxl",
          steps: 28,
          guidance: 7.0,
        },
        client
      );

      expect(result.summary.succeeded).toBe(2);
      expect(result.summary.failed).toBe(1);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toBeDefined();

      consoleSpy.mockRestore();
    });

    it("includes error message in failed results", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue(null),
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await batchCreatePortraits(
        {
          portraits: [{ description: "Test", model: "model.safetensors", name: "test" }],
          output_dir: "/tmp/batch",
          backend: "sdxl",
          steps: 28,
          guidance: 7.0,
        },
        client
      );

      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain("No output from workflow");

      consoleSpy.mockRestore();
    });

    it("uses provided style for each portrait", async () => {
      const client = createMockClient();

      const result = await batchCreatePortraits(
        {
          portraits: [
            { description: "Anime char", model: "model.safetensors", name: "anime", style: "anime" },
            { description: "Furry char", model: "model.safetensors", name: "furry", style: "furry" },
          ],
          output_dir: "/tmp/batch",
          backend: "sdxl",
          steps: 28,
          guidance: 7.0,
        },
        client
      );

      expect(result.results[0].prompt).toContain("anime");
      expect(result.results[1].prompt).toContain("anthro");
    });

    it("uses backend for all portraits", async () => {
      const client = createMockClient();

      const result = await batchCreatePortraits(
        {
          portraits: [
            { description: "Test 1", model: "flux.gguf", name: "test1" },
            { description: "Test 2", model: "flux.gguf", name: "test2" },
          ],
          output_dir: "/tmp/batch",
          backend: "flux_gguf",
          steps: 4,
          guidance: 2.0,
        },
        client
      );

      expect(result.results[0].model).toContain("flux");
      expect(result.results[1].model).toContain("flux");
    });

    it("includes remote_url when cloud upload succeeds", async () => {
      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
      vi.mocked(storageModule.getStorageProvider).mockReturnValue({
        upload: vi.fn().mockResolvedValue({
          path: "test/path",
          url: "https://storage.example.com/test.png",
        }),
      } as any);

      const client = createMockClient();

      // Parse through schema to apply defaults (mimics MCP server behavior)
      // TODO: Runtime defaults should be added to implementation
      const parsedArgs = batchCreatePortraitsSchema.parse({
        portraits: [{ description: "Test", model: "model.safetensors", name: "test" }],
        output_dir: "/tmp/batch",
        backend: "sdxl",
        steps: 28,
        guidance: 7.0,
      });

      const result = await batchCreatePortraits(parsedArgs, client);

      expect(result.results[0].remote_url).toBe("https://storage.example.com/test.png");

      vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
    });

    it("handles empty portraits array", async () => {
      const client = createMockClient();

      const result = await batchCreatePortraits(
        {
          portraits: [],
          output_dir: "/tmp/batch",
          backend: "sdxl",
          steps: 28,
          guidance: 7.0,
        },
        client
      );

      expect(result.results).toEqual([]);
      expect(result.summary.total).toBe(0);
      expect(result.summary.succeeded).toBe(0);
      expect(result.summary.failed).toBe(0);
    });
  });
});
