import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listModels, listSamplers, listSchedulers, listLoras } from "./list-models.js";
import { ComfyUIClient } from "../comfyui-client.js";
import { createMockFetch, mockObjectInfo } from "../__mocks__/comfyui-responses.js";

describe("listModels", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({ url: "http://localhost:8188" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should return list of checkpoint models", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const models = await listModels(client);

    expect(models).toEqual([
      "dreamshaper_8.safetensors",
      "sdXL_v10.safetensors",
      "cyberrealistic_v90.safetensors",
    ]);
  });

  it("should return empty array if no models found", async () => {
    global.fetch = createMockFetch({
      objectInfo: {},
    }) as typeof fetch;

    const models = await listModels(client);

    expect(models).toEqual([]);
  });
});

describe("listSamplers", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({ url: "http://localhost:8188" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should return list of samplers", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const samplers = await listSamplers(client);

    expect(samplers).toEqual([
      "euler",
      "euler_ancestral",
      "dpmpp_2m",
      "dpmpp_sde",
      "ddim",
    ]);
  });

  it("should return empty array if no samplers found", async () => {
    global.fetch = createMockFetch({
      objectInfo: {},
    }) as typeof fetch;

    const samplers = await listSamplers(client);

    expect(samplers).toEqual([]);
  });
});

describe("listSchedulers", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({ url: "http://localhost:8188" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should return list of schedulers", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const schedulers = await listSchedulers(client);

    expect(schedulers).toEqual([
      "normal",
      "karras",
      "exponential",
      "sgm_uniform",
    ]);
  });

  it("should return empty array if no schedulers found", async () => {
    global.fetch = createMockFetch({
      objectInfo: {},
    }) as typeof fetch;

    const schedulers = await listSchedulers(client);

    expect(schedulers).toEqual([]);
  });
});

describe("listLoras", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({ url: "http://localhost:8188" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should return list of LoRAs", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const loras = await listLoras(client);

    expect(loras).toEqual([
      "style_lora.safetensors",
      "character_lora.safetensors",
    ]);
  });

  it("should return empty array if no LoRAs found", async () => {
    global.fetch = createMockFetch({
      objectInfo: {},
    }) as typeof fetch;

    const loras = await listLoras(client);

    expect(loras).toEqual([]);
  });
});
