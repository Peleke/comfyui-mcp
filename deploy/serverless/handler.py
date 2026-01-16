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
import mimetypes
from pathlib import Path
from datetime import date

# Configuration
COMFYUI_HOST = "127.0.0.1"
COMFYUI_PORT = 8188
COMFYUI_URL = f"http://{COMFYUI_HOST}:{COMFYUI_PORT}"
STARTUP_TIMEOUT = 120  # seconds to wait for ComfyUI to start
OUTPUT_DIR = "/workspace/ComfyUI/output"
NETWORK_VOLUME = "/runpod-volume"
COMFYUI_MODELS = "/workspace/ComfyUI/models"

# Supabase Configuration (optional - falls back to base64 if not set)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "comfyui-outputs")

# Global ComfyUI process
comfyui_process = None


def setup_model_symlinks():
    """Symlink network volume models into ComfyUI models folder."""
    if not os.path.exists(NETWORK_VOLUME):
        print(f"Network volume not found at {NETWORK_VOLUME}")
        return

    # Model directories to symlink
    model_dirs = [
        "checkpoints",
        "loras",
        "vae",
        "controlnet",
        "clip",
        "clip_vision",
        "sonic",
        "video",
        "f5_tts",
        "whisper",
        "animatediff_models",
    ]

    for model_dir in model_dirs:
        volume_path = os.path.join(NETWORK_VOLUME, model_dir)
        comfyui_path = os.path.join(COMFYUI_MODELS, model_dir)

        if os.path.exists(volume_path):
            # Remove existing dir/link if present
            if os.path.islink(comfyui_path):
                os.unlink(comfyui_path)
            elif os.path.isdir(comfyui_path):
                import shutil
                shutil.rmtree(comfyui_path)

            os.symlink(volume_path, comfyui_path)
            print(f"Linked {model_dir}: {volume_path} -> {comfyui_path}")

    # Also symlink input directories for voices/avatars
    for input_dir in ["voices", "avatars"]:
        volume_path = os.path.join(NETWORK_VOLUME, input_dir)
        comfyui_path = os.path.join("/workspace/ComfyUI/input", input_dir)

        if os.path.exists(volume_path):
            if os.path.islink(comfyui_path):
                os.unlink(comfyui_path)
            elif os.path.isdir(comfyui_path):
                import shutil
                shutil.rmtree(comfyui_path)

            os.symlink(volume_path, comfyui_path)
            print(f"Linked input/{input_dir}")


def start_comfyui():
    """Start ComfyUI server in background."""
    global comfyui_process

    if comfyui_process is not None:
        return

    # Setup symlinks before starting
    setup_model_symlinks()

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
    if response.status_code != 200:
        # Capture the actual error from ComfyUI
        try:
            error_details = response.json()
        except Exception:
            error_details = response.text
        raise RuntimeError(f"ComfyUI error ({response.status_code}): {error_details}")
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
        # Check various audio output keys (ComfyUI nodes use different ones)
        for audio_key in ["audio", "audios", "flac", "flacs"]:
            if audio_key in node_output:
                for audio in node_output[audio_key]:
                    files.append({
                        "type": "audio",
                        "filename": audio["filename"],
                        "subfolder": audio.get("subfolder", ""),
                        "path": os.path.join(OUTPUT_DIR, audio.get("subfolder", ""), audio["filename"])
                    })

    return files


def file_to_base64(filepath: str) -> str:
    """Read file and return base64 encoded content."""
    with open(filepath, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def supabase_enabled() -> bool:
    """Check if Supabase is configured."""
    return bool(SUPABASE_URL and SUPABASE_KEY)


def upload_to_supabase(local_path: str, remote_path: str) -> dict:
    """
    Upload file to Supabase Storage and return URLs.

    Uses raw HTTP requests to avoid supabase-py dependency.
    """
    with open(local_path, "rb") as f:
        file_data = f.read()

    # Guess content type
    content_type, _ = mimetypes.guess_type(local_path)
    if not content_type:
        content_type = "application/octet-stream"

    # Upload via Supabase Storage API
    upload_url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{remote_path}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": content_type,
        "x-upsert": "true"
    }

    response = requests.post(upload_url, headers=headers, data=file_data)
    response.raise_for_status()

    # Build URLs
    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{remote_path}"

    # Create signed URL (1 hour expiry)
    sign_url = f"{SUPABASE_URL}/storage/v1/object/sign/{SUPABASE_BUCKET}/{remote_path}"
    sign_response = requests.post(
        sign_url,
        headers={"Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"},
        json={"expiresIn": 3600}
    )

    signed_url = None
    if sign_response.status_code == 200:
        signed_data = sign_response.json()
        signed_url = f"{SUPABASE_URL}/storage/v1{signed_data.get('signedURL', '')}"

    return {
        "url": public_url,
        "signed_url": signed_url,
        "path": remote_path,
        "size": len(file_data)
    }


def get_debug_info() -> dict:
    """Get debug info about volume, models, and ComfyUI status."""
    debug = {
        "volume_exists": os.path.exists(NETWORK_VOLUME),
        "volume_contents": [],
        "checkpoints_path": os.path.join(NETWORK_VOLUME, "checkpoints"),
        "checkpoints_exists": False,
        "checkpoints_contents": [],
        "sonic_path": os.path.join(NETWORK_VOLUME, "sonic"),
        "sonic_exists": False,
        "sonic_contents": [],
        "supabase_configured": supabase_enabled(),
        "comfyui_process_alive": comfyui_process is not None and comfyui_process.poll() is None,
    }

    if debug["volume_exists"]:
        try:
            debug["volume_contents"] = os.listdir(NETWORK_VOLUME)[:20]
        except Exception as e:
            debug["volume_contents"] = [f"Error: {e}"]

    if os.path.exists(debug["checkpoints_path"]):
        debug["checkpoints_exists"] = True
        try:
            debug["checkpoints_contents"] = os.listdir(debug["checkpoints_path"])[:20]
        except Exception as e:
            debug["checkpoints_contents"] = [f"Error: {e}"]

    if os.path.exists(debug["sonic_path"]):
        debug["sonic_exists"] = True
        try:
            debug["sonic_contents"] = os.listdir(debug["sonic_path"])[:20]
        except Exception as e:
            debug["sonic_contents"] = [f"Error: {e}"]

    # Check voices directory
    voices_path = os.path.join(NETWORK_VOLUME, "voices")
    debug["voices_path"] = voices_path
    if os.path.exists(voices_path):
        debug["voices_exists"] = True
        try:
            debug["voices_contents"] = os.listdir(voices_path)[:20]
        except Exception as e:
            debug["voices_contents"] = [f"Error: {e}"]
    else:
        debug["voices_exists"] = False

    # Check f5_tts directory
    f5_path = os.path.join(NETWORK_VOLUME, "f5_tts")
    debug["f5_tts_path"] = f5_path
    if os.path.exists(f5_path):
        debug["f5_tts_exists"] = True
        try:
            debug["f5_tts_contents"] = os.listdir(f5_path)[:20]
        except Exception as e:
            debug["f5_tts_contents"] = [f"Error: {e}"]
    else:
        debug["f5_tts_exists"] = False

    # Check ComfyUI input/voices symlink
    comfyui_voices = "/workspace/ComfyUI/input/voices"
    debug["comfyui_voices_is_symlink"] = os.path.islink(comfyui_voices)
    debug["comfyui_voices_exists"] = os.path.exists(comfyui_voices)
    if debug["comfyui_voices_exists"]:
        try:
            debug["comfyui_voices_contents"] = os.listdir(comfyui_voices)[:20]
        except Exception as e:
            debug["comfyui_voices_contents"] = [f"Error: {e}"]

    # Check ComfyUI models folder (should have symlinks)
    comfyui_checkpoints = os.path.join(COMFYUI_MODELS, "checkpoints")
    debug["comfyui_checkpoints_path"] = comfyui_checkpoints
    debug["comfyui_checkpoints_is_symlink"] = os.path.islink(comfyui_checkpoints)
    if os.path.exists(comfyui_checkpoints):
        debug["comfyui_checkpoints_exists"] = True
        try:
            debug["comfyui_checkpoints_contents"] = os.listdir(comfyui_checkpoints)[:20]
            if os.path.islink(comfyui_checkpoints):
                debug["comfyui_checkpoints_target"] = os.readlink(comfyui_checkpoints)
        except Exception as e:
            debug["comfyui_checkpoints_contents"] = [f"Error: {e}"]
    else:
        debug["comfyui_checkpoints_exists"] = False

    # Check ComfyUI API if running
    if debug["comfyui_process_alive"]:
        try:
            resp = requests.get(f"{COMFYUI_URL}/system_stats", timeout=2)
            debug["comfyui_api_status"] = resp.status_code
        except Exception as e:
            debug["comfyui_api_status"] = f"Error: {e}"

    return debug


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
    """Build F5-TTS workflow for voice cloning using niknah/ComfyUI-F5-TTS.

    Uses LoadAudio + F5TTSAudioInputs to properly load voice samples.
    Voice files should be in input/voices/: sample.wav + sample.txt (transcript)
    """
    text = params.get("text", "Hello world")
    sample = params.get("sample", "sample.wav")  # audio file in input/voices folder
    speed = params.get("speed", 1.0)
    seed = params.get("seed", -1)
    model = params.get("model", "F5v1")  # F5v1, F5, E2, etc.

    if seed == -1:
        seed = int.from_bytes(os.urandom(4), "big")

    # Read transcript from .txt file (same name as audio)
    sample_base = sample.rsplit(".", 1)[0]  # remove extension
    transcript_path = f"/workspace/ComfyUI/input/voices/{sample_base}.txt"
    try:
        with open(transcript_path, "r") as f:
            sample_text = f.read().strip()
    except FileNotFoundError:
        sample_text = ""  # Fallback if no transcript

    return {
        "1": {
            "class_type": "LoadAudio",
            "inputs": {
                "audio": f"voices/{sample}"
            }
        },
        "2": {
            "class_type": "F5TTSAudioInputs",
            "inputs": {
                "sample_audio": ["1", 0],
                "sample_text": sample_text,
                "speech": text,
                "seed": seed,
                "model": model,
                "vocoder": "vocos",
                "speed": speed,
                "model_type": "F5TTS_v1_Base"
            }
        },
        "3": {
            "class_type": "SaveAudio",
            "inputs": {
                "audio": ["2", 0],
                "filename_prefix": "tts/ComfyUI_TTS"
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
# Workflow Validation
# ============================================================================

def get_comfyui_schema() -> dict:
    """Fetch object_info schema from ComfyUI."""
    try:
        response = requests.get(f"{COMFYUI_URL}/object_info", timeout=10)
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        print(f"Failed to fetch schema: {e}")
    return {}


def validate_workflow(workflow: dict) -> dict:
    """
    Validate workflow against ComfyUI's object_info schema.
    Returns {"valid": True} or {"valid": False, "errors": [...]}
    """
    schema = get_comfyui_schema()
    if not schema:
        return {"valid": True, "warning": "Could not fetch schema for validation"}

    errors = []

    for node_id, node in workflow.items():
        class_type = node.get("class_type")
        inputs = node.get("inputs", {})

        # Check if node type exists
        if class_type not in schema:
            errors.append({
                "node_id": node_id,
                "error": f"Unknown node type: {class_type}",
                "available_types": "Use 'schema' action to list available nodes"
            })
            continue

        node_schema = schema[class_type]
        input_schema = node_schema.get("input", {})

        # Combine required and optional inputs
        all_inputs = {}
        for category in ["required", "optional"]:
            if category in input_schema:
                all_inputs.update(input_schema[category])

        # Validate each input
        for input_name, input_value in inputs.items():
            # Skip connections (lists like ["1", 0])
            if isinstance(input_value, list):
                continue

            if input_name not in all_inputs:
                # Unknown input - might be ok (dynamic inputs)
                continue

            input_def = all_inputs[input_name]
            if isinstance(input_def, list) and len(input_def) > 0:
                valid_values = input_def[0]
                # Check enum values
                if isinstance(valid_values, list) and input_value not in valid_values:
                    errors.append({
                        "node_id": node_id,
                        "class_type": class_type,
                        "input": input_name,
                        "error": f"Invalid value: '{input_value}'",
                        "valid_values": valid_values
                    })

    if errors:
        return {"valid": False, "errors": errors}
    return {"valid": True}


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

        # Handle non-workflow actions first
        if action == "health":
            return {
                "status": "healthy",
                "comfyui_url": COMFYUI_URL,
                "supabase_configured": supabase_enabled()
            }
        elif action == "debug":
            return get_debug_info()
        elif action == "schema":
            # Return schema for specific node or list all nodes
            schema = get_comfyui_schema()
            node_type = input_data.get("node_type")
            if node_type:
                if node_type in schema:
                    return {"node_type": node_type, "schema": schema[node_type]}
                return {"error": f"Unknown node type: {node_type}"}
            return {"nodes": list(schema.keys())[:100], "total": len(schema)}
        elif action == "validate":
            # Validate a workflow without executing
            workflow = input_data.get("workflow")
            if not workflow:
                return {"error": "No workflow provided"}
            return validate_workflow(workflow)

        # Build appropriate workflow
        if action == "portrait":
            workflow = build_portrait_workflow(input_data)
        elif action == "tts":
            workflow = build_tts_workflow(input_data)
        elif action == "lipsync":
            workflow = build_lipsync_workflow(input_data)
        else:
            return {"error": f"Unknown action: {action}"}

        # Queue and wait for completion
        prompt_id = queue_prompt(workflow)
        print(f"Queued prompt: {prompt_id}")

        history = wait_for_completion(prompt_id)
        print(f"Workflow completed")

        # Debug: show what's in history outputs
        outputs = history.get("outputs", {})
        print(f"History outputs keys: {list(outputs.keys())}")
        for node_id, node_output in outputs.items():
            print(f"  Node {node_id}: {list(node_output.keys())}")

        # Get output files
        output_files = get_output_files(history)

        # Fallback: if no audio files found in history for TTS, scan output/tts folder
        if action == "tts" and not any(f["type"] == "audio" for f in output_files):
            print("No audio in history, scanning output/tts folder...")
            tts_output_dir = os.path.join(OUTPUT_DIR, "tts")
            if os.path.exists(tts_output_dir):
                # Get most recent flac/wav file
                import glob
                audio_files = glob.glob(os.path.join(tts_output_dir, "*.flac")) + \
                              glob.glob(os.path.join(tts_output_dir, "*.wav"))
                if audio_files:
                    # Sort by modification time, newest first
                    audio_files.sort(key=os.path.getmtime, reverse=True)
                    latest = audio_files[0]
                    print(f"Found audio file via scan: {latest}")
                    output_files.append({
                        "type": "audio",
                        "filename": os.path.basename(latest),
                        "subfolder": "tts",
                        "path": latest
                    })

        # Upload to Supabase if configured, otherwise return base64
        results = []
        use_supabase = supabase_enabled()

        for file_info in output_files:
            file_path = file_info["path"]
            file_size = os.path.getsize(file_path)

            result = {
                "type": file_info["type"],
                "filename": file_info["filename"]
            }

            if use_supabase:
                # Upload to Supabase Storage
                try:
                    today = date.today().isoformat()
                    unique_id = str(uuid.uuid4())[:8]
                    remote_path = f"outputs/{today}/{unique_id}/{file_info['filename']}"

                    upload_result = upload_to_supabase(file_path, remote_path)
                    result.update(upload_result)
                    print(f"Uploaded to Supabase: {remote_path}")
                except Exception as e:
                    # Fall back to base64 on upload error
                    print(f"Supabase upload failed, falling back to base64: {e}")
                    result["data"] = file_to_base64(file_path)
                    result["encoding"] = "base64"
                    result["upload_error"] = str(e)
            else:
                # No Supabase - use base64 for files under 10MB
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
            "prompt_id": prompt_id,
            "storage": "supabase" if use_supabase else "base64"
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
