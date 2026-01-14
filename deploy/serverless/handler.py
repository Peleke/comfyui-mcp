"""
RunPod Serverless Handler for ComfyUI

Wraps ComfyUI workflows for serverless execution.
Supports: portrait generation, TTS voice cloning, lip-sync video generation.

Usage:
    Endpoint receives: {"input": {"action": "portrait", "description": "...", ...}}
    Returns: {"output": {"image_url": "...", "seed": ...}}
"""

import runpod
import subprocess
import requests
import json
import time
import os
import base64
import uuid
from pathlib import Path

# Configuration
COMFYUI_HOST = "127.0.0.1"
COMFYUI_PORT = 8188
COMFYUI_URL = f"http://{COMFYUI_HOST}:{COMFYUI_PORT}"
STARTUP_TIMEOUT = 120  # seconds to wait for ComfyUI to start
OUTPUT_DIR = "/workspace/ComfyUI/output"

# Global ComfyUI process
comfyui_process = None


def start_comfyui():
    """Start ComfyUI server in background."""
    global comfyui_process

    if comfyui_process is not None:
        return

    print("Starting ComfyUI server...")
    comfyui_process = subprocess.Popen(
        ["python", "main.py", "--listen", COMFYUI_HOST, "--port", str(COMFYUI_PORT)],
        cwd="/workspace/ComfyUI",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT
    )

    # Wait for ComfyUI to be ready
    start_time = time.time()
    while time.time() - start_time < STARTUP_TIMEOUT:
        try:
            response = requests.get(f"{COMFYUI_URL}/system_stats", timeout=2)
            if response.status_code == 200:
                print(f"ComfyUI ready after {time.time() - start_time:.1f}s")
                return
        except requests.exceptions.RequestException:
            pass
        time.sleep(1)

    raise RuntimeError(f"ComfyUI failed to start within {STARTUP_TIMEOUT}s")


def queue_prompt(workflow: dict) -> str:
    """Queue a workflow and return prompt ID."""
    response = requests.post(
        f"{COMFYUI_URL}/prompt",
        json={"prompt": workflow}
    )
    response.raise_for_status()
    return response.json()["prompt_id"]


def wait_for_completion(prompt_id: str, timeout: int = 300) -> dict:
    """Poll for workflow completion."""
    start_time = time.time()

    while time.time() - start_time < timeout:
        response = requests.get(f"{COMFYUI_URL}/history/{prompt_id}")
        if response.status_code == 200:
            history = response.json()
            if prompt_id in history:
                return history[prompt_id]
        time.sleep(0.5)

    raise TimeoutError(f"Workflow did not complete within {timeout}s")


def get_output_files(history: dict) -> list:
    """Extract output file paths from history."""
    files = []
    outputs = history.get("outputs", {})

    for node_id, node_output in outputs.items():
        if "images" in node_output:
            for img in node_output["images"]:
                files.append({
                    "type": "image",
                    "filename": img["filename"],
                    "subfolder": img.get("subfolder", ""),
                    "path": os.path.join(OUTPUT_DIR, img.get("subfolder", ""), img["filename"])
                })
        if "gifs" in node_output:
            for gif in node_output["gifs"]:
                files.append({
                    "type": "video",
                    "filename": gif["filename"],
                    "subfolder": gif.get("subfolder", ""),
                    "path": os.path.join(OUTPUT_DIR, gif.get("subfolder", ""), gif["filename"])
                })

    return files


def file_to_base64(filepath: str) -> str:
    """Read file and return base64 encoded content."""
    with open(filepath, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


# ============================================================================
# Workflow Builders
# ============================================================================

def build_portrait_workflow(params: dict) -> dict:
    """Build txt2img workflow for portrait generation."""

    model = params.get("model", "sd_xl_base_1.0.safetensors")
    prompt = params.get("prompt", params.get("description", "A portrait"))
    negative = params.get("negative_prompt", "low quality, blurry, distorted")
    width = params.get("width", 768)
    height = params.get("height", 1024)
    steps = params.get("steps", 20)
    cfg = params.get("cfg_scale", 7.0)
    seed = params.get("seed", -1)

    if seed == -1:
        seed = int.from_bytes(os.urandom(4), "big")

    return {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": "euler_ancestral",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0]
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": model}
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1}
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": ["4", 1]}
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative, "clip": ["4", 1]}
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]}
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": f"portrait_{seed}", "images": ["8", 0]}
        }
    }


def build_tts_workflow(params: dict) -> dict:
    """Build F5-TTS workflow for voice cloning."""

    text = params.get("text", "Hello world")
    voice_ref = params.get("voice_reference", "reference.wav")
    voice_text = params.get("voice_reference_text", "")
    speed = params.get("speed", 1.0)
    seed = params.get("seed", -1)

    if seed == -1:
        seed = int.from_bytes(os.urandom(4), "big")

    return {
        "1": {
            "class_type": "LoadAudio",
            "inputs": {"audio": voice_ref}
        },
        "2": {
            "class_type": "F5TTSAudioInputs",
            "inputs": {
                "sample_audio": ["1", 0],
                "speech": text,
                "ref_text": voice_text,
                "speed": speed,
                "seed": seed
            }
        },
        "3": {
            "class_type": "F5TTSGenerate",
            "inputs": {
                "audio_inputs": ["2", 0],
                "model": "F5TTS_v1_Base"
            }
        },
        "4": {
            "class_type": "SaveAudioTensor",
            "inputs": {
                "audio": ["3", 0],
                "filename_prefix": f"tts_{seed}"
            }
        }
    }


def build_lipsync_workflow(params: dict) -> dict:
    """Build SONIC lip-sync workflow."""

    portrait = params.get("portrait_image", "portrait.png")
    audio = params.get("audio", "speech.wav")
    svd_model = params.get("svd_checkpoint", "svd_xt_1_1.safetensors")
    sonic_unet = params.get("sonic_unet", "sonic_unet.pth")
    steps = params.get("inference_steps", 25)
    fps = params.get("fps", 25.0)

    return {
        "1": {
            "class_type": "ImageOnlyCheckpointLoader",
            "inputs": {"ckpt_name": f"video/{svd_model}"}
        },
        "2": {
            "class_type": "LoadImage",
            "inputs": {"image": portrait}
        },
        "3": {
            "class_type": "LoadAudio",
            "inputs": {"audio": audio}
        },
        "4": {
            "class_type": "SONICTLoader",
            "inputs": {
                "model": ["1", 0],
                "sonic_unet": sonic_unet
            }
        },
        "5": {
            "class_type": "SONIC_PreData",
            "inputs": {
                "clip_vision": ["1", 1],
                "vae": ["1", 2],
                "audio": ["3", 0],
                "image": ["2", 0]
            }
        },
        "6": {
            "class_type": "SONICSampler",
            "inputs": {
                "model": ["4", 0],
                "data_dict": ["5", 0],
                "steps": steps,
                "cfg": 2.5
            }
        },
        "7": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["6", 0],
                "audio": ["3", 0],
                "frame_rate": fps,
                "filename_prefix": "lipsync"
            }
        }
    }


# ============================================================================
# Main Handler
# ============================================================================

def handler(event: dict) -> dict:
    """
    Main RunPod handler.

    Input format:
        {"input": {"action": "portrait|tts|lipsync", ...params}}

    Output format:
        {"output": {"files": [...], "seed": ..., "status": "success|error"}}
    """
    try:
        # Ensure ComfyUI is running
        start_comfyui()

        input_data = event.get("input", {})
        action = input_data.get("action", "portrait")

        print(f"Processing action: {action}")

        # Build appropriate workflow
        if action == "portrait":
            workflow = build_portrait_workflow(input_data)
        elif action == "tts":
            workflow = build_tts_workflow(input_data)
        elif action == "lipsync":
            workflow = build_lipsync_workflow(input_data)
        elif action == "health":
            return {
                "status": "healthy",
                "comfyui_url": COMFYUI_URL
            }
        else:
            return {"error": f"Unknown action: {action}"}

        # Queue and wait for completion
        prompt_id = queue_prompt(workflow)
        print(f"Queued prompt: {prompt_id}")

        history = wait_for_completion(prompt_id)
        print(f"Workflow completed")

        # Get output files
        output_files = get_output_files(history)

        # Return base64-encoded files for small outputs, or paths for large ones
        results = []
        for file_info in output_files:
            file_path = file_info["path"]
            file_size = os.path.getsize(file_path)

            result = {
                "type": file_info["type"],
                "filename": file_info["filename"]
            }

            # Base64 encode files under 10MB
            if file_size < 10 * 1024 * 1024:
                result["data"] = file_to_base64(file_path)
                result["encoding"] = "base64"
            else:
                result["path"] = file_path
                result["size_bytes"] = file_size

            results.append(result)

        return {
            "status": "success",
            "action": action,
            "files": results,
            "prompt_id": prompt_id
        }

    except Exception as e:
        print(f"Error: {e}")
        return {
            "status": "error",
            "error": str(e)
        }


# Entry point
if __name__ == "__main__":
    print("Starting RunPod Serverless Handler")
    runpod.serverless.start({"handler": handler})
