import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listAvatars,
  listVoicesCatalog,
  createPortrait,
  listAvatarsSchema,
  listVoicesCatalogSchema,
  createPortraitSchema,
  AVATAR_SUBFOLDER,
  VOICE_SUBFOLDER,
} from "./avatar.js";
import { ComfyUIClient } from "../comfyui-client.js";
import * as fs from "fs/promises";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
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
      expect(client.waitForCompletion).toHaveBeenCalledWith("test-prompt-id");
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
  });
});
