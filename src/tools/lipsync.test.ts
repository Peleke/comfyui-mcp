import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  lipSyncGenerate,
  talk,
  listLipSyncModels,
  lipSyncGenerateSchema,
  talkSchema,
} from "./lipsync.js";
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

// Mock backend module
vi.mock("../backend/index.js", () => ({
  isRunPodConfigured: vi.fn().mockReturnValue(false),
  getBackendFor: vi.fn().mockReturnValue({
    name: "runpod",
    lipsync: vi.fn().mockResolvedValue({
      success: true,
      files: [{ type: "video", filename: "test.mp4", remoteUrl: "https://example.com/test.mp4" }],
      backend: "runpod",
    }),
  }),
}));

import * as backendModule from "../backend/index.js";

// Mock ComfyUIClient
const createMockClient = (overrides: Partial<ComfyUIClient> = {}) => ({
  baseUrl: "http://localhost:8188",
  wsUrl: "ws://localhost:8188",
  outputDir: "/tmp/comfyui-output",
  queuePrompt: vi.fn().mockResolvedValue({ prompt_id: "test-prompt-id", number: 1 }),
  waitForCompletion: vi.fn().mockResolvedValue({
    status: { status_str: "success", completed: true, messages: [] },
    outputs: {
      "9": {
        gifs: [{
          filename: "ComfyUI_LipSync_00001.mp4",
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
  getImage: vi.fn(),
  getAudio: vi.fn(),
  getVideo: vi.fn().mockResolvedValue(Buffer.from("fake-video-data")),
  ...overrides,
}) as unknown as ComfyUIClient;

describe("Lip-Sync Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("lipSyncGenerateSchema", () => {
    it("validates required fields", () => {
      const validInput = {
        portrait_image: "portrait.png",
        audio: "speech.wav",
        output_path: "/tmp/output.mp4",
      };

      const result = lipSyncGenerateSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("applies default values", () => {
      const input = {
        portrait_image: "portrait.png",
        audio: "speech.wav",
        output_path: "/tmp/output.mp4",
      };

      const result = lipSyncGenerateSchema.parse(input);
      expect(result.model).toBe("sonic");
      expect(result.svd_checkpoint).toBe("video/svd_xt_1_1.safetensors");
      expect(result.sonic_unet).toBe("unet.pth");
      expect(result.ip_audio_scale).toBe(1.0);
      expect(result.use_interframe).toBe(true);
      expect(result.dtype).toBe("fp16");
      expect(result.min_resolution).toBe(512);
      expect(result.duration).toBe(99999);
      expect(result.expand_ratio).toBe(1);
      expect(result.inference_steps).toBe(25);
      expect(result.dynamic_scale).toBe(1.0);
      expect(result.fps).toBe(25.0);
    });

    it("rejects invalid model", () => {
      const input = {
        portrait_image: "portrait.png",
        audio: "speech.wav",
        output_path: "/tmp/output.mp4",
        model: "invalid-model",
      };

      const result = lipSyncGenerateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts valid model options", () => {
      const models = ["sonic", "dice-talk", "hallo2", "sadtalker"];

      for (const model of models) {
        const result = lipSyncGenerateSchema.safeParse({
          portrait_image: "portrait.png",
          audio: "speech.wav",
          output_path: "/tmp/output.mp4",
          model,
        });
        expect(result.success).toBe(true);
      }
    });

    it("validates dtype options", () => {
      const dtypes = ["fp16", "fp32", "bf16"];

      for (const dtype of dtypes) {
        const result = lipSyncGenerateSchema.safeParse({
          portrait_image: "portrait.png",
          audio: "speech.wav",
          output_path: "/tmp/output.mp4",
          dtype,
        });
        expect(result.success).toBe(true);
      }
    });

    it("validates backend options", () => {
      const backends = ["auto", "local", "runpod"];

      for (const backend of backends) {
        const result = lipSyncGenerateSchema.safeParse({
          portrait_image: "portrait.png",
          audio: "speech.wav",
          output_path: "/tmp/output.mp4",
          backend,
        });
        expect(result.success).toBe(true);
      }
    });

    it("defaults backend to auto", () => {
      const input = {
        portrait_image: "portrait.png",
        audio: "speech.wav",
        output_path: "/tmp/output.mp4",
      };

      const result = lipSyncGenerateSchema.parse(input);
      expect(result.backend).toBe("auto");
    });

    it("rejects invalid backend", () => {
      const result = lipSyncGenerateSchema.safeParse({
        portrait_image: "portrait.png",
        audio: "speech.wav",
        output_path: "/tmp/output.mp4",
        backend: "invalid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("talkSchema", () => {
    it("validates required fields", () => {
      const validInput = {
        text: "Hello, world!",
        voice_reference: "voice.wav",
        portrait_image: "portrait.png",
        output_path: "/tmp/output.mp4",
      };

      const result = talkSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("applies default values", () => {
      const input = {
        text: "Hello, world!",
        voice_reference: "voice.wav",
        portrait_image: "portrait.png",
        output_path: "/tmp/output.mp4",
      };

      const result = talkSchema.parse(input);
      expect(result.speed).toBe(1.0);
      expect(result.sonic_unet).toBe("unet.pth");
      expect(result.inference_steps).toBe(25);
      expect(result.fps).toBe(25.0);
    });

    it("accepts all optional parameters", () => {
      const input = {
        text: "Hello, world!",
        voice_reference: "voice.wav",
        voice_reference_text: "This is the voice reference.",
        portrait_image: "portrait.png",
        speed: 1.2,
        tts_seed: 42,
        svd_checkpoint: "video/svd_xt_1_1.safetensors",
        sonic_unet: "custom_unet.pth",
        inference_steps: 30,
        fps: 30.0,
        lipsync_seed: 123,
        output_path: "/tmp/output.mp4",
      };

      const result = talkSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("lipSyncGenerate", () => {
    it("generates video from portrait and audio", async () => {
      const client = createMockClient();

      const result = await lipSyncGenerate(
        {
          portrait_image: "portrait.png",
          audio: "speech.wav",
          output_path: "/tmp/lipsync_output.mp4",
          model: "sonic",
          sonic_unet: "unet.pth",
          ip_audio_scale: 1.0,
          use_interframe: true,
          dtype: "fp16",
          min_resolution: 512,
          duration: 10.0,
          expand_ratio: 0.5,
          inference_steps: 25,
          dynamic_scale: 1.0,
          fps: 25.0,
        },
        client
      );

      expect(client.queuePrompt).toHaveBeenCalledTimes(1);
      expect(client.waitForCompletion).toHaveBeenCalledWith("test-prompt-id", expect.any(Function));
      expect(client.getVideo).toHaveBeenCalledWith(
        "ComfyUI_LipSync_00001.mp4",
        "",
        "output"
      );
      expect(result.video).toBe("/tmp/lipsync_output.mp4");
    });

    it("handles videos array format", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue({
          status: { status_str: "success", completed: true, messages: [] },
          outputs: {
            "9": {
              videos: [{
                filename: "output.mp4",
                subfolder: "videos",
                type: "output",
              }],
            },
          },
        }),
      });

      const result = await lipSyncGenerate(
        {
          portrait_image: "portrait.png",
          audio: "speech.wav",
          output_path: "/tmp/out.mp4",
          model: "sonic",
          sonic_unet: "unet.pth",
          ip_audio_scale: 1.0,
          use_interframe: true,
          dtype: "fp16",
          min_resolution: 512,
          duration: 10.0,
          expand_ratio: 0.5,
          inference_steps: 25,
          dynamic_scale: 1.0,
          fps: 25.0,
        },
        client
      );

      expect(client.getVideo).toHaveBeenCalledWith("output.mp4", "videos", "output");
      expect(result.video).toBe("/tmp/out.mp4");
    });

    it("creates output directory if needed", async () => {
      const client = createMockClient();

      await lipSyncGenerate(
        {
          portrait_image: "portrait.png",
          audio: "speech.wav",
          output_path: "/deep/nested/dir/output.mp4",
          model: "sonic",
          sonic_unet: "unet.pth",
          ip_audio_scale: 1.0,
          use_interframe: true,
          dtype: "fp16",
          min_resolution: 512,
          duration: 10.0,
          expand_ratio: 0.5,
          inference_steps: 25,
          dynamic_scale: 1.0,
          fps: 25.0,
        },
        client
      );

      expect(fs.mkdir).toHaveBeenCalledWith("/deep/nested/dir", { recursive: true });
    });

    it("throws for non-sonic models (not implemented)", async () => {
      const client = createMockClient();

      await expect(
        lipSyncGenerate(
          {
            portrait_image: "portrait.png",
            audio: "speech.wav",
            output_path: "/tmp/out.mp4",
            model: "dice-talk",
            sonic_unet: "unet.pth",
            ip_audio_scale: 1.0,
            use_interframe: true,
            dtype: "fp16",
            min_resolution: 512,
            duration: 10.0,
            expand_ratio: 0.5,
            inference_steps: 25,
            dynamic_scale: 1.0,
            fps: 25.0,
          },
          client
        )
      ).rejects.toThrow("not yet implemented");
    });

    it("throws on missing workflow output", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue({
          status: { status_str: "success", completed: true, messages: [] },
          outputs: {},
        }),
      });

      await expect(
        lipSyncGenerate(
          {
            portrait_image: "portrait.png",
            audio: "speech.wav",
            output_path: "/tmp/out.mp4",
            model: "sonic",
            sonic_unet: "unet.pth",
            ip_audio_scale: 1.0,
            use_interframe: true,
            dtype: "fp16",
            min_resolution: 512,
            duration: 10.0,
            expand_ratio: 0.5,
            inference_steps: 25,
            dynamic_scale: 1.0,
            fps: 25.0,
          },
          client
        )
      ).rejects.toThrow("No video or image output found");
    });

    it("throws on null history", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue(null),
      });

      await expect(
        lipSyncGenerate(
          {
            portrait_image: "portrait.png",
            audio: "speech.wav",
            output_path: "/tmp/out.mp4",
            model: "sonic",
            sonic_unet: "unet.pth",
            ip_audio_scale: 1.0,
            use_interframe: true,
            dtype: "fp16",
            min_resolution: 512,
            duration: 10.0,
            expand_ratio: 0.5,
            inference_steps: 25,
            dynamic_scale: 1.0,
            fps: 25.0,
          },
          client
        )
      ).rejects.toThrow("No output from workflow");
    });

    it("respects inference_steps parameter", async () => {
      const client = createMockClient();

      await lipSyncGenerate(
        {
          portrait_image: "portrait.png",
          audio: "speech.wav",
          output_path: "/tmp/out.mp4",
          model: "sonic",
          sonic_unet: "unet.pth",
          ip_audio_scale: 1.0,
          use_interframe: true,
          dtype: "fp16",
          min_resolution: 512,
          duration: 10.0,
          expand_ratio: 0.5,
          inference_steps: 50,
          dynamic_scale: 1.0,
          fps: 25.0,
        },
        client
      );

      const queueCall = (client.queuePrompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const workflow = queueCall[0];
      // Node "8" is SONICSampler in the workflow
      expect(workflow["8"].inputs.inference_steps).toBe(50);
    });
  });

  describe("talk", () => {
    const createTalkMockClient = () => createMockClient({
      waitForCompletion: vi.fn().mockResolvedValue({
        status: { status_str: "success", completed: true, messages: [] },
        outputs: {
          "output": {
            gifs: [{
              filename: "ComfyUI_TalkingAvatar_00001.mp4",
              subfolder: "",
              type: "output",
            }],
          },
        },
      }),
    });

    it("generates video from text and portrait (full pipeline)", async () => {
      const client = createTalkMockClient();

      const result = await talk(
        {
          text: "Hello, world!",
          voice_reference: "voice.wav",
          portrait_image: "portrait.png",
          output_path: "/tmp/talk_output.mp4",
          speed: 1.0,
          sonic_unet: "unet.pth",
          inference_steps: 25,
          fps: 25.0,
        },
        client
      );

      expect(client.queuePrompt).toHaveBeenCalledTimes(1);
      expect(client.waitForCompletion).toHaveBeenCalledWith("test-prompt-id", expect.any(Function));
      expect(client.getVideo).toHaveBeenCalled();
      expect(result.video).toBe("/tmp/talk_output.mp4");
      expect(result.text).toBe("Hello, world!");
    });

    it("handles videos array format", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue({
          status: { status_str: "success", completed: true, messages: [] },
          outputs: {
            "output": {
              videos: [{
                filename: "avatar.mp4",
                subfolder: "output",
                type: "output",
              }],
            },
          },
        }),
      });

      const result = await talk(
        {
          text: "Test",
          voice_reference: "voice.wav",
          portrait_image: "portrait.png",
          output_path: "/tmp/out.mp4",
          speed: 1.0,
          sonic_unet: "unet.pth",
          inference_steps: 25,
          fps: 25.0,
        },
        client
      );

      expect(client.getVideo).toHaveBeenCalledWith("avatar.mp4", "output", "output");
      expect(result.video).toBe("/tmp/out.mp4");
    });

    it("throws on missing video output", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue({
          status: { status_str: "success", completed: true, messages: [] },
          outputs: {
            "output": {},
          },
        }),
      });

      await expect(
        talk(
          {
            text: "Test",
            voice_reference: "voice.wav",
            portrait_image: "portrait.png",
            output_path: "/tmp/out.mp4",
            speed: 1.0,
            sonic_unet: "unet.pth",
            inference_steps: 25,
            fps: 25.0,
          },
          client
        )
      ).rejects.toThrow("No video output found");
    });

    it("creates output directory", async () => {
      const client = createTalkMockClient();

      await talk(
        {
          text: "Test",
          voice_reference: "voice.wav",
          portrait_image: "portrait.png",
          output_path: "/new/dir/output.mp4",
          speed: 1.0,
          sonic_unet: "unet.pth",
          inference_steps: 25,
          fps: 25.0,
        },
        client
      );

      expect(fs.mkdir).toHaveBeenCalledWith("/new/dir", { recursive: true });
    });

    it("passes optional parameters through workflow", async () => {
      const client = createTalkMockClient();

      await talk(
        {
          text: "Custom params test",
          voice_reference: "voice.wav",
          voice_reference_text: "Reference transcript",
          portrait_image: "portrait.png",
          speed: 1.5,
          tts_seed: 42,
          svd_checkpoint: "video/svd_xt_1_1.safetensors",
          sonic_unet: "custom_unet.pth",
          inference_steps: 30,
          fps: 30.0,
          lipsync_seed: 123,
          output_path: "/tmp/out.mp4",
        },
        client
      );

      const queueCall = (client.queuePrompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const workflow = queueCall[0];

      // Check TTS params (node "tts_2" is F5TTSAudioInputs)
      expect(workflow["tts_2"].inputs.speech).toBe("Custom params test");
      expect(workflow["tts_2"].inputs.speed).toBe(1.5);
      expect(workflow["tts_2"].inputs.seed).toBe(42);

      // Check lip-sync params (node "sonic_5" is SONICSampler)
      expect(workflow["sonic_5"].inputs.inference_steps).toBe(30);
    });
  });

  describe("listLipSyncModels", () => {
    it("returns available models when SONIC is installed", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          SONICTLoader: {
            input: {
              required: {
                sonic_unet: [["unet.pth", "unet_v2.pth", "none"]],
              },
            },
          },
        }),
      });

      const result = await listLipSyncModels({}, client);

      expect(result.sonic.available).toBe(true);
      expect(result.sonic.models).toContain("unet.pth");
      expect(result.sonic.models).toContain("unet_v2.pth");
      expect(result.sonic.models).not.toContain("none");
    });

    it("returns unavailable when SONIC is not installed", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({}),
      });

      const result = await listLipSyncModels({}, client);

      expect(result.sonic.available).toBe(false);
      expect(result.sonic.models).toEqual([]);
    });

    it("detects DICE-Talk when available", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          DICETalkLoader: {},
        }),
      });

      const result = await listLipSyncModels({}, client);

      expect(result["dice-talk"].available).toBe(true);
    });

    it("detects Hallo2 when available", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          Hallo2Loader: {},
        }),
      });

      const result = await listLipSyncModels({}, client);

      expect(result.hallo2.available).toBe(true);
    });

    it("detects SadTalker when available", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          SadTalkerLoader: {},
        }),
      });

      const result = await listLipSyncModels({}, client);

      expect(result.sadtalker.available).toBe(true);
    });

    it("returns all models' status correctly", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          SONICTLoader: {
            input: {
              required: {
                sonic_unet: [["unet.pth"]],
              },
            },
          },
          DICETalkLoader: {},
          // Hallo2 and SadTalker not installed
        }),
      });

      const result = await listLipSyncModels({}, client);

      expect(result.sonic.available).toBe(true);
      expect(result["dice-talk"].available).toBe(true);
      expect(result.hallo2.available).toBe(false);
      expect(result.sadtalker.available).toBe(false);
    });
  });
});

describe("Integration: TTS → LipSync Chain", () => {
  it("output from talk() contains both video and original text", async () => {
    const client = createMockClient({
      waitForCompletion: vi.fn().mockResolvedValue({
        status: { status_str: "success", completed: true, messages: [] },
        outputs: {
          "output": {
            gifs: [{
              filename: "avatar.mp4",
              subfolder: "",
              type: "output",
            }],
          },
        },
      }),
    });

    const inputText = "This is the original text that was spoken.";
    const result = await talk(
      {
        text: inputText,
        voice_reference: "voice.wav",
        portrait_image: "portrait.png",
        output_path: "/tmp/out.mp4",
        speed: 1.0,
        sonic_unet: "unet.pth",
        inference_steps: 25,
        fps: 25.0,
      },
      client
    );

    expect(result.text).toBe(inputText);
    expect(result.video).toBeTruthy();
  });
});

describe("lipSyncGenerate - Cloud Upload", () => {
  const baseArgs = {
    portrait_image: "portrait.png",
    audio: "speech.wav",
    model: "sonic" as const,
    sonic_unet: "unet.pth",
    ip_audio_scale: 1.0,
    use_interframe: true,
    dtype: "fp16" as const,
    min_resolution: 512,
    duration: 10.0,
    expand_ratio: 0.5,
    inference_steps: 25,
    dynamic_scale: 1.0,
    fps: 25.0,
  };

  afterEach(() => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
  });

  it("does not upload when cloud storage is not configured", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
    const client = createMockClient();

    const result = await lipSyncGenerate(
      { ...baseArgs, output_path: "/tmp/out.mp4" },
      client
    );

    expect(storageModule.getStorageProvider).not.toHaveBeenCalled();
    expect(result.remote_url).toBeUndefined();
  });

  it("uploads to cloud when configured and upload_to_cloud is true", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    const mockUpload = vi.fn().mockResolvedValue({
      path: "generated/videos/123_out.mp4",
      url: "https://storage.example.com/generated/videos/123_out.mp4",
    });
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: mockUpload,
    } as any);

    const client = createMockClient();

    const result = await lipSyncGenerate(
      { ...baseArgs, output_path: "/tmp/out.mp4", upload_to_cloud: true },
      client
    );

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(result.remote_url).toBe("https://storage.example.com/generated/videos/123_out.mp4");
  });

  it("does not upload when upload_to_cloud is false", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    const mockUpload = vi.fn();
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: mockUpload,
    } as any);

    const client = createMockClient();

    const result = await lipSyncGenerate(
      { ...baseArgs, output_path: "/tmp/out.mp4", upload_to_cloud: false },
      client
    );

    expect(mockUpload).not.toHaveBeenCalled();
    expect(result.remote_url).toBeUndefined();
  });

  it("defaults upload_to_cloud to true", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    const mockUpload = vi.fn().mockResolvedValue({
      path: "generated/videos/out.mp4",
      url: "https://storage.example.com/out.mp4",
    });
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: mockUpload,
    } as any);

    const client = createMockClient();

    await lipSyncGenerate(
      { ...baseArgs, output_path: "/tmp/out.mp4" },
      client
    );

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

    const result = await lipSyncGenerate(
      { ...baseArgs, output_path: "/tmp/out.mp4" },
      client
    );

    expect(result.video).toBe("/tmp/out.mp4");
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

    const result = await lipSyncGenerate(
      { ...baseArgs, output_path: "/tmp/out.mp4" },
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
    vi.mocked(storageModule.generateRemotePath).mockReturnValue("generated/videos/timestamp_video.mp4");

    const client = createMockClient();

    await lipSyncGenerate(
      { ...baseArgs, output_path: "/tmp/my_video.mp4" },
      client
    );

    expect(storageModule.generateRemotePath).toHaveBeenCalledWith("videos", "my_video.mp4");
    expect(mockUpload).toHaveBeenCalledWith(
      "/tmp/my_video.mp4",
      "generated/videos/timestamp_video.mp4"
    );
  });
});

describe("lipSyncGenerate - Progress Callbacks", () => {
  const baseArgs = {
    portrait_image: "portrait.png",
    audio: "speech.wav",
    model: "sonic" as const,
    sonic_unet: "unet.pth",
    ip_audio_scale: 1.0,
    use_interframe: true,
    dtype: "fp16" as const,
    min_resolution: 512,
    duration: 10.0,
    expand_ratio: 0.5,
    inference_steps: 25,
    dynamic_scale: 1.0,
    fps: 25.0,
    output_path: "/tmp/out.mp4",
  };

  it("calls progress callback with all stages", async () => {
    const client = createMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await lipSyncGenerate(baseArgs, client, { onProgress });

    expect(progressEvents.length).toBeGreaterThan(0);
    const stages = progressEvents.map(e => e.stage);
    expect(stages).toContain("queued");
    expect(stages).toContain("starting");
    expect(stages).toContain("loading_model");
    expect(stages).toContain("generating");
    expect(stages).toContain("post_processing");
    expect(stages).toContain("complete");
  });

  it("emits error stage for unsupported model", async () => {
    const client = createMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await expect(
      lipSyncGenerate(
        { ...baseArgs, model: "dice-talk" as any },
        client,
        { onProgress }
      )
    ).rejects.toThrow();

    const stages = progressEvents.map(e => e.stage);
    expect(stages).toContain("error");
  });

  it("emits error stage when workflow fails", async () => {
    const client = createMockClient({
      waitForCompletion: vi.fn().mockResolvedValue(null),
    });
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await expect(
      lipSyncGenerate(baseArgs, client, { onProgress })
    ).rejects.toThrow();

    const stages = progressEvents.map(e => e.stage);
    expect(stages).toContain("error");
  });

  it("progress events have correct taskId", async () => {
    const client = createMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await lipSyncGenerate(baseArgs, client, { onProgress, taskId: "test_task_lipsync" });

    expect(progressEvents.every(e => e.taskId === "test_task_lipsync")).toBe(true);
  });

  it("progress events have timestamps", async () => {
    const client = createMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await lipSyncGenerate(baseArgs, client, { onProgress });

    expect(progressEvents.every(e => e.timestamp > 0)).toBe(true);
  });

  it("returns taskId in result", async () => {
    const client = createMockClient();

    const result = await lipSyncGenerate(baseArgs, client);

    expect(result.taskId).toBeDefined();
    expect(result.taskId).toMatch(/^task_\d+_[a-z0-9]+$/);
  });

  it("uses provided taskId when given", async () => {
    const client = createMockClient();

    const result = await lipSyncGenerate(baseArgs, client, { taskId: "custom_lipsync_task" });

    expect(result.taskId).toBe("custom_lipsync_task");
  });

  it("works without progress callback", async () => {
    const client = createMockClient();

    const result = await lipSyncGenerate(baseArgs, client);

    expect(result.video).toBeDefined();
  });

  it("includes uploading stage when cloud upload is configured", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: vi.fn().mockResolvedValue({ path: "test", url: "https://test.com" }),
    } as any);

    const client = createMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await lipSyncGenerate(baseArgs, client, { onProgress });

    const stages = progressEvents.map(e => e.stage);
    expect(stages).toContain("uploading");

    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
  });
});

describe("talk - Cloud Upload", () => {
  const baseArgs = {
    text: "Hello world",
    voice_reference: "voice.wav",
    portrait_image: "portrait.png",
    speed: 1.0,
    sonic_unet: "unet.pth",
    inference_steps: 25,
    fps: 25.0,
    output_path: "/tmp/talk.mp4",
  };

  const createTalkMockClient = () => createMockClient({
    waitForCompletion: vi.fn().mockResolvedValue({
      status: { status_str: "success", completed: true, messages: [] },
      outputs: {
        "output": {
          gifs: [{
            filename: "talk.mp4",
            subfolder: "",
            type: "output",
          }],
        },
      },
    }),
  });

  afterEach(() => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
  });

  it("uploads to cloud when configured", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    const mockUpload = vi.fn().mockResolvedValue({
      path: "generated/videos/talk.mp4",
      url: "https://storage.example.com/talk.mp4",
    });
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: mockUpload,
    } as any);

    const client = createTalkMockClient();

    const result = await talk(baseArgs, client);

    expect(mockUpload).toHaveBeenCalled();
    expect(result.remote_url).toBe("https://storage.example.com/talk.mp4");
  });

  it("does not upload when upload_to_cloud is false", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    const mockUpload = vi.fn();
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: mockUpload,
    } as any);

    const client = createTalkMockClient();

    const result = await talk({ ...baseArgs, upload_to_cloud: false }, client);

    expect(mockUpload).not.toHaveBeenCalled();
    expect(result.remote_url).toBeUndefined();
  });

  it("continues when upload fails", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: vi.fn().mockRejectedValue(new Error("Upload failed")),
    } as any);

    const client = createTalkMockClient();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await talk(baseArgs, client);

    expect(result.video).toBe("/tmp/talk.mp4");
    expect(result.remote_url).toBeUndefined();

    consoleSpy.mockRestore();
  });
});

describe("talk - Progress Callbacks", () => {
  const baseArgs = {
    text: "Hello world",
    voice_reference: "voice.wav",
    portrait_image: "portrait.png",
    speed: 1.0,
    sonic_unet: "unet.pth",
    inference_steps: 25,
    fps: 25.0,
    output_path: "/tmp/talk.mp4",
  };

  const createTalkMockClient = () => createMockClient({
    waitForCompletion: vi.fn().mockResolvedValue({
      status: { status_str: "success", completed: true, messages: [] },
      outputs: {
        "output": {
          gifs: [{
            filename: "talk.mp4",
            subfolder: "",
            type: "output",
          }],
        },
      },
    }),
  });

  it("calls progress callback with all stages", async () => {
    const client = createTalkMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await talk(baseArgs, client, { onProgress });

    const stages = progressEvents.map(e => e.stage);
    expect(stages).toContain("queued");
    expect(stages).toContain("starting");
    expect(stages).toContain("generating");
    expect(stages).toContain("complete");
  });

  it("emits error stage when workflow fails", async () => {
    const client = createMockClient({
      waitForCompletion: vi.fn().mockResolvedValue(null),
    });
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await expect(
      talk(baseArgs, client, { onProgress })
    ).rejects.toThrow();

    const stages = progressEvents.map(e => e.stage);
    expect(stages).toContain("error");
  });

  it("returns taskId in result", async () => {
    const client = createTalkMockClient();

    const result = await talk(baseArgs, client);

    expect(result.taskId).toBeDefined();
    expect(result.taskId).toMatch(/^task_\d+_[a-z0-9]+$/);
  });

  it("uses provided taskId", async () => {
    const client = createTalkMockClient();

    const result = await talk(baseArgs, client, { taskId: "custom_talk_task" });

    expect(result.taskId).toBe("custom_talk_task");
  });

  it("progress events maintain correct taskId throughout", async () => {
    const client = createTalkMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await talk(baseArgs, client, { onProgress, taskId: "talk_test_123" });

    expect(progressEvents.every(e => e.taskId === "talk_test_123")).toBe(true);
  });
});

describe("lipSyncGenerate - Backend Routing", () => {
  const baseArgs = {
    portrait_image: "portrait.png",
    audio: "speech.wav",
    model: "sonic" as const,
    output_path: "/tmp/out.mp4",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(false);
  });

  it("uses local backend when backend is 'local'", async () => {
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(true); // Even if RunPod is configured
    const client = createMockClient();

    await lipSyncGenerate({ ...baseArgs, backend: "local" }, client);

    // Should NOT call getBackendFor - should use local implementation
    expect(backendModule.getBackendFor).not.toHaveBeenCalled();
    expect(client.queuePrompt).toHaveBeenCalled();
  });

  it("uses local backend when backend is 'auto' and RunPod not configured", async () => {
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(false);
    const client = createMockClient();

    await lipSyncGenerate({ ...baseArgs, backend: "auto" }, client);

    expect(backendModule.getBackendFor).not.toHaveBeenCalled();
    expect(client.queuePrompt).toHaveBeenCalled();
  });

  it("uses RunPod backend when backend is 'runpod'", async () => {
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(true);
    const mockLipsync = vi.fn().mockResolvedValue({
      success: true,
      files: [{ type: "video", filename: "test.mp4", remoteUrl: "https://example.com/test.mp4" }],
      backend: "runpod",
    });
    vi.mocked(backendModule.getBackendFor).mockReturnValue({
      name: "runpod",
      lipsync: mockLipsync,
    } as any);

    const client = createMockClient();

    const result = await lipSyncGenerate({ ...baseArgs, backend: "runpod" }, client);

    expect(backendModule.getBackendFor).toHaveBeenCalledWith("lipsync");
    expect(mockLipsync).toHaveBeenCalled();
    expect(client.queuePrompt).not.toHaveBeenCalled();
    expect(result.remote_url).toBe("https://example.com/test.mp4");
  });

  it("uses RunPod backend when backend is 'auto' and RunPod is configured", async () => {
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(true);
    const mockLipsync = vi.fn().mockResolvedValue({
      success: true,
      files: [{ type: "video", filename: "test.mp4", signedUrl: "https://signed.example.com/test.mp4" }],
      backend: "runpod",
    });
    vi.mocked(backendModule.getBackendFor).mockReturnValue({
      name: "runpod",
      lipsync: mockLipsync,
    } as any);

    const client = createMockClient();

    const result = await lipSyncGenerate({ ...baseArgs, backend: "auto" }, client);

    expect(backendModule.getBackendFor).toHaveBeenCalledWith("lipsync");
    expect(mockLipsync).toHaveBeenCalled();
    expect(result.remote_url).toBe("https://signed.example.com/test.mp4");
  });

  it("passes correct params to RunPod backend", async () => {
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(true);
    const mockLipsync = vi.fn().mockResolvedValue({
      success: true,
      files: [{ type: "video", filename: "test.mp4" }],
      backend: "runpod",
    });
    vi.mocked(backendModule.getBackendFor).mockReturnValue({
      name: "runpod",
      lipsync: mockLipsync,
    } as any);

    const client = createMockClient();

    await lipSyncGenerate({
      ...baseArgs,
      backend: "runpod",
      duration: 15,
      inference_steps: 30,
      fps: 30,
      seed: 42,
    }, client);

    expect(mockLipsync).toHaveBeenCalledWith(expect.objectContaining({
      portraitImage: "portrait.png",
      audio: "speech.wav",
      duration: 15,
      inferenceSteps: 30,
      fps: 30,
      seed: 42,
      outputPath: "/tmp/out.mp4",
    }));
  });

  it("throws when RunPod backend returns failure", async () => {
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(true);
    vi.mocked(backendModule.getBackendFor).mockReturnValue({
      name: "runpod",
      lipsync: vi.fn().mockResolvedValue({
        success: false,
        files: [],
        error: "RunPod processing failed",
        backend: "runpod",
      }),
    } as any);

    const client = createMockClient();

    await expect(
      lipSyncGenerate({ ...baseArgs, backend: "runpod" }, client)
    ).rejects.toThrow("RunPod processing failed");
  });

  it("emits progress events for RunPod path", async () => {
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(true);
    vi.mocked(backendModule.getBackendFor).mockReturnValue({
      name: "runpod",
      lipsync: vi.fn().mockResolvedValue({
        success: true,
        files: [{ type: "video", filename: "test.mp4" }],
        backend: "runpod",
      }),
    } as any);

    const client = createMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await lipSyncGenerate({ ...baseArgs, backend: "runpod" }, client, { onProgress });

    const stages = progressEvents.map(e => e.stage);
    expect(stages).toContain("queued");
    expect(stages).toContain("starting");
    expect(stages).toContain("complete");
  });

  it("returns taskId for RunPod path", async () => {
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(true);
    vi.mocked(backendModule.getBackendFor).mockReturnValue({
      name: "runpod",
      lipsync: vi.fn().mockResolvedValue({
        success: true,
        files: [{ type: "video", filename: "test.mp4" }],
        backend: "runpod",
      }),
    } as any);

    const client = createMockClient();

    const result = await lipSyncGenerate({ ...baseArgs, backend: "runpod" }, client);

    expect(result.taskId).toBeDefined();
  });

  it("uses provided taskId for RunPod path", async () => {
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(true);
    vi.mocked(backendModule.getBackendFor).mockReturnValue({
      name: "runpod",
      lipsync: vi.fn().mockResolvedValue({
        success: true,
        files: [{ type: "video", filename: "test.mp4" }],
        backend: "runpod",
      }),
    } as any);

    const client = createMockClient();

    const result = await lipSyncGenerate(
      { ...baseArgs, backend: "runpod" },
      client,
      { taskId: "custom_runpod_task" }
    );

    expect(result.taskId).toBe("custom_runpod_task");
  });

  it("prefers remoteUrl over signedUrl in result", async () => {
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(true);
    vi.mocked(backendModule.getBackendFor).mockReturnValue({
      name: "runpod",
      lipsync: vi.fn().mockResolvedValue({
        success: true,
        files: [{
          type: "video",
          filename: "test.mp4",
          remoteUrl: "https://public.url/test.mp4",
          signedUrl: "https://signed.url/test.mp4?token=abc",
        }],
        backend: "runpod",
      }),
    } as any);

    const client = createMockClient();

    const result = await lipSyncGenerate({ ...baseArgs, backend: "runpod" }, client);

    expect(result.remote_url).toBe("https://public.url/test.mp4");
  });

  it("falls back to signedUrl when remoteUrl not present", async () => {
    vi.mocked(backendModule.isRunPodConfigured).mockReturnValue(true);
    vi.mocked(backendModule.getBackendFor).mockReturnValue({
      name: "runpod",
      lipsync: vi.fn().mockResolvedValue({
        success: true,
        files: [{
          type: "video",
          filename: "test.mp4",
          signedUrl: "https://signed.url/test.mp4?token=abc",
        }],
        backend: "runpod",
      }),
    } as any);

    const client = createMockClient();

    const result = await lipSyncGenerate({ ...baseArgs, backend: "runpod" }, client);

    expect(result.remote_url).toBe("https://signed.url/test.mp4?token=abc");
  });
});
