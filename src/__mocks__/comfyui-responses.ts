/**
 * Mock responses for ComfyUI API endpoints
 */

export const mockObjectInfo = {
  CheckpointLoaderSimple: {
    input: {
      required: {
        ckpt_name: [
          [
            "dreamshaper_8.safetensors",
            "sdXL_v10.safetensors",
            "cyberrealistic_v90.safetensors",
          ],
        ],
      },
    },
  },
  KSampler: {
    input: {
      required: {
        sampler_name: [
          ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_sde", "ddim"],
        ],
        scheduler: [["normal", "karras", "exponential", "sgm_uniform"]],
      },
    },
  },
  LoraLoader: {
    input: {
      required: {
        lora_name: [["style_lora.safetensors", "character_lora.safetensors"]],
      },
    },
  },
  UpscaleModelLoader: {
    input: {
      required: {
        model_name: [["RealESRGAN_x4plus.pth", "4x-UltraSharp.pth"]],
      },
    },
  },
  ControlNetLoader: {
    input: {
      required: {
        control_net_name: [
          [
            "control_v11p_sd15_canny_fp16.safetensors",
            "control_v11p_sd15_depth_fp16.safetensors",
            "control_v11p_sd15_openpose_fp16.safetensors",
            "control_v11p_sd15_scribble_fp16.safetensors",
            "control_v11p_sd15_lineart_fp16.safetensors",
            "control_sd15_qrcode_monster.safetensors",
            "control_v11p_sd15_seg_fp16.safetensors",
          ],
        ],
      },
    },
  },
};

export const mockQueueStatus = {
  queue_running: [],
  queue_pending: [],
};

export const mockQueueStatusBusy = {
  queue_running: [
    [1, "test-prompt-id", { prompt: "test" }, ["node1"], ["node2"]],
  ],
  queue_pending: [
    [2, "pending-prompt-id", { prompt: "pending" }, ["node1"], []],
  ],
};

export const mockQueuePromptResponse = {
  prompt_id: "test-prompt-id-12345",
  number: 1,
};

export const mockHistoryComplete = {
  "test-prompt-id-12345": {
    prompt: {},
    outputs: {
      "9": {
        images: [
          {
            filename: "ComfyUI_00001_.png",
            subfolder: "",
            type: "output",
          },
        ],
      },
    },
    status: {
      status_str: "success",
      completed: true,
      messages: [],
    },
  },
};

export const mockHistoryUpscaleComplete = {
  "test-prompt-id-12345": {
    prompt: {},
    outputs: {
      "5": {
        images: [
          {
            filename: "ComfyUI_upscale_00001_.png",
            subfolder: "",
            type: "output",
          },
        ],
      },
    },
    status: {
      status_str: "success",
      completed: true,
      messages: [],
    },
  },
};

export const mockImageBuffer = Buffer.from("fake-image-data");

/**
 * Create a mock fetch function for ComfyUI API
 */
export function createMockFetch(overrides: {
  objectInfo?: any;
  queueStatus?: any;
  queuePromptResponse?: any;
  history?: any;
  imageBuffer?: Buffer;
} = {}) {
  const config = {
    objectInfo: overrides.objectInfo ?? mockObjectInfo,
    queueStatus: overrides.queueStatus ?? mockQueueStatus,
    queuePromptResponse: overrides.queuePromptResponse ?? mockQueuePromptResponse,
    history: overrides.history ?? mockHistoryComplete,
    imageBuffer: overrides.imageBuffer ?? mockImageBuffer,
  };

  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === "string" ? url : url.toString();

    // GET /object_info
    if (urlStr.includes("/object_info") && init?.method === "GET") {
      return new Response(JSON.stringify(config.objectInfo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /queue
    if (urlStr.includes("/queue") && init?.method === "GET") {
      return new Response(JSON.stringify(config.queueStatus), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /prompt
    if (urlStr.includes("/prompt") && init?.method === "POST") {
      return new Response(JSON.stringify(config.queuePromptResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /history/:id
    if (urlStr.includes("/history/")) {
      const promptId = urlStr.split("/history/")[1];
      const historyData = config.history[promptId as keyof typeof config.history]
        ? { [promptId]: config.history[promptId as keyof typeof config.history] }
        : config.history;
      return new Response(JSON.stringify(historyData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /view (image)
    if (urlStr.includes("/view")) {
      return new Response(new Uint8Array(config.imageBuffer), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }

    // Default: 404
    return new Response("Not found", { status: 404 });
  };
}
