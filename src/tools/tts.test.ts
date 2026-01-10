import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ttsGenerate,
  listTTSModels,
  listVoices,
  ttsGenerateSchema,
} from "./tts.js";
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

// Mock ComfyUIClient
const createMockClient = (overrides: Partial<ComfyUIClient> = {}) => ({
  baseUrl: "http://localhost:8188",
  wsUrl: "ws://localhost:8188",
  outputDir: "/tmp/comfyui-output",
  queuePrompt: vi.fn().mockResolvedValue({ prompt_id: "test-prompt-id", number: 1 }),
  waitForCompletion: vi.fn().mockResolvedValue({
    status: { status_str: "success", completed: true, messages: [] },
    outputs: {
      "3": {
        audio: [{
          filename: "ComfyUI_TTS_00001.wav",
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
  getAudio: vi.fn().mockResolvedValue(Buffer.from("fake-audio-data")),
  getVideo: vi.fn(),
  ...overrides,
}) as unknown as ComfyUIClient;

describe("TTS Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ttsGenerateSchema", () => {
    it("validates required fields", () => {
      const validInput = {
        text: "Hello, world!",
        voice_reference: "reference.wav",
        output_path: "/tmp/output.wav",
      };

      const result = ttsGenerateSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("applies default values", () => {
      const input = {
        text: "Hello, world!",
        voice_reference: "reference.wav",
        output_path: "/tmp/output.wav",
      };

      const result = ttsGenerateSchema.parse(input);
      expect(result.speed).toBe(1.0);
      expect(result.seed).toBe(-1);
      expect(result.model).toBe("F5TTS_v1_Base");
      expect(result.vocoder).toBe("vocos");
    });

    it("rejects invalid vocoder", () => {
      const input = {
        text: "Hello",
        voice_reference: "ref.wav",
        output_path: "/tmp/out.wav",
        vocoder: "invalid",
      };

      const result = ttsGenerateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts optional voice_reference_text", () => {
      const input = {
        text: "Hello, world!",
        voice_reference: "reference.wav",
        voice_reference_text: "This is the reference text.",
        output_path: "/tmp/output.wav",
      };

      const result = ttsGenerateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("ttsGenerate", () => {
    it("generates audio from text with voice reference", async () => {
      const client = createMockClient();

      const result = await ttsGenerate(
        {
          text: "Hello, world!",
          voice_reference: "reference.wav",
          output_path: "/tmp/tts_output.wav",
          speed: 1.0,
          seed: -1,
          model: "F5TTS_v1_Base",
          vocoder: "vocos",
        },
        client
      );

      expect(client.queuePrompt).toHaveBeenCalledTimes(1);
      expect(client.waitForCompletion).toHaveBeenCalledWith("test-prompt-id", expect.any(Function));
      expect(client.getAudio).toHaveBeenCalledWith(
        "ComfyUI_TTS_00001.wav",
        "",
        "output"
      );
      expect(result.audio).toBe("/tmp/tts_output.wav");
      expect(result.text).toBe("Hello, world!");
    });

    it("handles audios array format", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue({
          status: { status_str: "success", completed: true, messages: [] },
          outputs: {
            "3": {
              audios: [{
                filename: "ComfyUI_TTS_00002.wav",
                subfolder: "audio",
                type: "output",
              }],
            },
          },
        }),
      });

      const result = await ttsGenerate(
        {
          text: "Test text",
          voice_reference: "voice.wav",
          output_path: "/tmp/out.wav",
          speed: 1.0,
          seed: 42,
          model: "F5TTS_v1_Base",
          vocoder: "vocos",
        },
        client
      );

      expect(client.getAudio).toHaveBeenCalledWith(
        "ComfyUI_TTS_00002.wav",
        "audio",
        "output"
      );
      expect(result.audio).toBe("/tmp/out.wav");
    });

    it("creates output directory if needed", async () => {
      const client = createMockClient();

      await ttsGenerate(
        {
          text: "Hello",
          voice_reference: "ref.wav",
          output_path: "/deep/nested/dir/output.wav",
          speed: 1.0,
          seed: -1,
          model: "F5TTS_v1_Base",
          vocoder: "vocos",
        },
        client
      );

      expect(fs.mkdir).toHaveBeenCalledWith("/deep/nested/dir", { recursive: true });
    });

    it("throws on missing workflow output", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue({
          status: { status_str: "success", completed: true, messages: [] },
          outputs: {},
        }),
      });

      await expect(
        ttsGenerate(
          {
            text: "Hello",
            voice_reference: "ref.wav",
            output_path: "/tmp/out.wav",
            speed: 1.0,
            seed: -1,
            model: "F5TTS_v1_Base",
            vocoder: "vocos",
          },
          client
        )
      ).rejects.toThrow("No audio output found");
    });

    it("throws on null history", async () => {
      const client = createMockClient({
        waitForCompletion: vi.fn().mockResolvedValue(null),
      });

      await expect(
        ttsGenerate(
          {
            text: "Hello",
            voice_reference: "ref.wav",
            output_path: "/tmp/out.wav",
            speed: 1.0,
            seed: -1,
            model: "F5TTS_v1_Base",
            vocoder: "vocos",
          },
          client
        )
      ).rejects.toThrow("No output from workflow");
    });

    it("respects speed parameter in workflow", async () => {
      const client = createMockClient();

      await ttsGenerate(
        {
          text: "Fast speech",
          voice_reference: "ref.wav",
          output_path: "/tmp/out.wav",
          speed: 1.5,
          seed: -1,
          model: "F5TTS_v1_Base",
          vocoder: "vocos",
        },
        client
      );

      const queueCall = (client.queuePrompt as ReturnType<typeof vi.fn>).mock.calls[0];
      const workflow = queueCall[0];
      expect(workflow["2"].inputs.speed).toBe(1.5);
    });
  });

  describe("listTTSModels", () => {
    it("returns available TTS models when F5-TTS is installed", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          F5TTSAudioInputs: {
            input: {
              required: {
                model: [["F5TTS_v1_Base", "F5TTS_v1_Large"]],
              },
            },
          },
        }),
      });

      const result = await listTTSModels({}, client);

      expect(result.f5tts.available).toBe(true);
      expect(result.f5tts.models).toContain("F5TTS_v1_Base");
      expect(result.f5tts.models).toContain("F5TTS_v1_Large");
    });

    it("returns unavailable when F5-TTS is not installed", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({}),
      });

      const result = await listTTSModels({}, client);

      expect(result.f5tts.available).toBe(false);
      expect(result.f5tts.models).toEqual([]);
    });

    it("detects XTTS when available", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          XTTS_INFER: {
            input: {
              required: {
                language: [["en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh", "ja", "hu", "ko", "hi"]],
              },
            },
          },
        }),
      });

      const result = await listTTSModels({}, client);

      expect(result.xtts.available).toBe(true);
      expect(result.xtts.models).toContain("en");
      expect(result.xtts.models).toContain("ja");
    });

    it("handles F5TTSAudio fallback node", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          F5TTSAudio: {
            input: {
              required: {
                model: [["F5TTS_Base"]],
              },
            },
          },
        }),
      });

      const result = await listTTSModels({}, client);

      expect(result.f5tts.available).toBe(true);
      expect(result.f5tts.models).toContain("F5TTS_Base");
    });
  });

  describe("listVoices", () => {
    it("returns voice samples from F5TTSAudio", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          F5TTSAudio: {
            input: {
              required: {
                sample: [["voice1.wav", "voice2.wav", "voice3.mp3"]],
              },
            },
          },
        }),
      });

      const result = await listVoices({}, client);

      expect(result.voices).toContain("voice1.wav");
      expect(result.voices).toContain("voice2.wav");
      expect(result.voices).toContain("voice3.mp3");
    });

    it("returns audio files from LoadAudio", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          LoadAudio: {
            input: {
              required: {
                audio: [["speech.wav", "music.mp3", "sound.flac", "video.mp4", "image.png"]],
              },
            },
          },
        }),
      });

      const result = await listVoices({}, client);

      expect(result.voices).toContain("speech.wav");
      expect(result.voices).toContain("music.mp3");
      expect(result.voices).toContain("sound.flac");
      expect(result.voices).not.toContain("video.mp4");
      expect(result.voices).not.toContain("image.png");
    });

    it("deduplicates voices from multiple sources", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({
          F5TTSAudio: {
            input: {
              required: {
                sample: [["common.wav", "f5only.wav"]],
              },
            },
          },
          LoadAudio: {
            input: {
              required: {
                audio: [["common.wav", "loadonly.wav"]],
              },
            },
          },
        }),
      });

      const result = await listVoices({}, client);

      const commonCount = result.voices.filter((v) => v === "common.wav").length;
      expect(commonCount).toBe(1);
      expect(result.voices).toContain("f5only.wav");
      expect(result.voices).toContain("loadonly.wav");
    });

    it("returns empty array when no voices available", async () => {
      const client = createMockClient({
        getObjectInfo: vi.fn().mockResolvedValue({}),
      });

      const result = await listVoices({}, client);

      expect(result.voices).toEqual([]);
    });
  });
});

describe("ttsGenerate - Cloud Upload", () => {
  const baseArgs = {
    text: "Hello, world!",
    voice_reference: "reference.wav",
    output_path: "/tmp/tts_output.wav",
    speed: 1.0,
    seed: -1,
    model: "F5TTS_v1_Base",
    vocoder: "vocos" as const,
  };

  afterEach(() => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
  });

  it("does not upload when cloud storage is not configured", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
    const client = createMockClient();

    const result = await ttsGenerate(baseArgs, client);

    expect(storageModule.getStorageProvider).not.toHaveBeenCalled();
    expect(result.remote_url).toBeUndefined();
  });

  it("uploads to cloud when configured and upload_to_cloud is true", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    const mockUpload = vi.fn().mockResolvedValue({
      path: "generated/audio/123_output.wav",
      url: "https://storage.example.com/generated/audio/123_output.wav",
    });
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: mockUpload,
    } as any);

    const client = createMockClient();

    const result = await ttsGenerate(
      { ...baseArgs, upload_to_cloud: true },
      client
    );

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(result.remote_url).toBe("https://storage.example.com/generated/audio/123_output.wav");
  });

  it("does not upload when upload_to_cloud is false", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    const mockUpload = vi.fn();
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: mockUpload,
    } as any);

    const client = createMockClient();

    const result = await ttsGenerate(
      { ...baseArgs, upload_to_cloud: false },
      client
    );

    expect(mockUpload).not.toHaveBeenCalled();
    expect(result.remote_url).toBeUndefined();
  });

  it("defaults upload_to_cloud to true", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    const mockUpload = vi.fn().mockResolvedValue({
      path: "generated/audio/out.wav",
      url: "https://storage.example.com/out.wav",
    });
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: mockUpload,
    } as any);

    const client = createMockClient();

    await ttsGenerate(baseArgs, client);

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

    const result = await ttsGenerate(baseArgs, client);

    expect(result.audio).toBe("/tmp/tts_output.wav");
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

    const result = await ttsGenerate(baseArgs, client);

    expect(result.remote_url).toBeUndefined();
  });

  it("passes correct remote path to upload", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    const mockUpload = vi.fn().mockResolvedValue({ path: "test", url: "https://test.com" });
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: mockUpload,
    } as any);
    vi.mocked(storageModule.generateRemotePath).mockReturnValue("generated/audio/timestamp_speech.wav");

    const client = createMockClient();

    await ttsGenerate(
      { ...baseArgs, output_path: "/tmp/my_speech.wav" },
      client
    );

    expect(storageModule.generateRemotePath).toHaveBeenCalledWith("audio", "my_speech.wav");
    expect(mockUpload).toHaveBeenCalledWith(
      "/tmp/my_speech.wav",
      "generated/audio/timestamp_speech.wav"
    );
  });
});

describe("ttsGenerate - Progress Callbacks", () => {
  const baseArgs = {
    text: "Hello, world!",
    voice_reference: "reference.wav",
    output_path: "/tmp/tts_output.wav",
    speed: 1.0,
    seed: -1,
    model: "F5TTS_v1_Base",
    vocoder: "vocos" as const,
  };

  it("calls progress callback with all stages", async () => {
    const client = createMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await ttsGenerate(baseArgs, client, { onProgress });

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
      ttsGenerate(baseArgs, client, { onProgress })
    ).rejects.toThrow();

    const stages = progressEvents.map(e => e.stage);
    expect(stages).toContain("error");
  });

  it("emits error stage when no audio output", async () => {
    const client = createMockClient({
      waitForCompletion: vi.fn().mockResolvedValue({
        status: { status_str: "success", completed: true, messages: [] },
        outputs: {},
      }),
    });
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await expect(
      ttsGenerate(baseArgs, client, { onProgress })
    ).rejects.toThrow();

    const stages = progressEvents.map(e => e.stage);
    expect(stages).toContain("error");
  });

  it("progress events have correct taskId", async () => {
    const client = createMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await ttsGenerate(baseArgs, client, { onProgress, taskId: "test_task_tts" });

    expect(progressEvents.every(e => e.taskId === "test_task_tts")).toBe(true);
  });

  it("progress events have timestamps", async () => {
    const client = createMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await ttsGenerate(baseArgs, client, { onProgress });

    expect(progressEvents.every(e => e.timestamp > 0)).toBe(true);
  });

  it("returns taskId in result", async () => {
    const client = createMockClient();

    const result = await ttsGenerate(baseArgs, client);

    expect(result.taskId).toBeDefined();
    expect(result.taskId).toMatch(/^task_\d+_[a-z0-9]+$/);
  });

  it("uses provided taskId when given", async () => {
    const client = createMockClient();

    const result = await ttsGenerate(baseArgs, client, { taskId: "custom_tts_task" });

    expect(result.taskId).toBe("custom_tts_task");
  });

  it("works without progress callback", async () => {
    const client = createMockClient();

    const result = await ttsGenerate(baseArgs, client);

    expect(result.audio).toBeDefined();
    expect(result.text).toBe("Hello, world!");
  });

  it("includes uploading stage when cloud upload is configured", async () => {
    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(true);
    vi.mocked(storageModule.getStorageProvider).mockReturnValue({
      upload: vi.fn().mockResolvedValue({ path: "test", url: "https://test.com" }),
    } as any);

    const client = createMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await ttsGenerate(baseArgs, client, { onProgress });

    const stages = progressEvents.map(e => e.stage);
    expect(stages).toContain("uploading");

    vi.mocked(storageModule.isCloudStorageConfigured).mockReturnValue(false);
  });

  it("progress ends at 100% on success", async () => {
    const client = createMockClient();
    const progressEvents: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => progressEvents.push(event);

    await ttsGenerate(baseArgs, client, { onProgress });

    const normalEvents = progressEvents.filter(e => e.stage !== "error");
    expect(normalEvents[normalEvents.length - 1].progress).toBe(100);
    expect(normalEvents[normalEvents.length - 1].stage).toBe("complete");
  });
});
