import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ttsGenerate,
  listTTSModels,
  listVoices,
  ttsGenerateSchema,
} from "./tts.js";
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
