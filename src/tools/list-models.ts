import { ComfyUIClient } from "../comfyui-client.js";

export async function listModels(client: ComfyUIClient): Promise<string[]> {
  return client.getModels();
}

export async function listSamplers(client: ComfyUIClient): Promise<string[]> {
  return client.getSamplers();
}

export async function listSchedulers(client: ComfyUIClient): Promise<string[]> {
  return client.getSchedulers();
}

export async function listLoras(client: ComfyUIClient): Promise<string[]> {
  const objectInfo = await client.getObjectInfo();
  const loraLoader = objectInfo["LoraLoader"];
  if (loraLoader?.input?.required?.lora_name?.[0]) {
    return loraLoader.input.required.lora_name[0];
  }
  return [];
}
