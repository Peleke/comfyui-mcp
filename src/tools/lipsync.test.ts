import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  lipSyncGenerate,
  talk,
  listLipSyncModels,
  lipSyncGenerateSchema,
  talkSchema,
} from "./lipsync.js";
import { ComfyUIClient } from "../comfyui-client.js";
import * as fs from "fs/promises";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

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
