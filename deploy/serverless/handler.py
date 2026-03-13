"""
RunPod Serverless Handler for ComfyUI

Wraps ComfyUI workflows for serverless execution.
Supports: portrait generation, TTS voice cloning, lip-sync video generation.

Usage:
    Endpoint receives: {"input": {"action": "portrait", "description": "...", ...}}
    Returns: {"output": {"files": [...], "seed": ..., "status": "success|error"}}
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
import logging
from pathlib import Path
from datetime import date

# ============================================================================
# Version & Configuration
# ============================================================================

HANDLER_VERSION = "v34"

# ComfyUI configuration
COMFYUI_HOST = "127.0.0.1"
COMFYUI_PORT = 8188
COMFYUI_URL = f"http://{COMFYUI_HOST}:{COMFYUI_PORT}"
STARTUP_TIMEOUT = 120  # seconds to wait for ComfyUI to start

# Paths
# Network volume is mounted at /runpod-volume (NOT /workspace)
# Docker container has ComfyUI at /workspace/ComfyUI
NETWORK_VOLUME = "/runpod-volume"
COMFYUI_DIR = "/workspace/ComfyUI"
COMFYUI_MODELS = "/workspace/ComfyUI/models"
COMFYUI_INPUT = "/workspace/ComfyUI/input"
OUTPUT_DIR = "/workspace/ComfyUI/output"

# Supabase Configuration (optional - falls back to base64 if not set)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "comfyui-outputs")

# Global ComfyUI process
comfyui_process = None

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
log = logging.getLogger("handler")


# ============================================================================
# Audio Duration Detection
# ============================================================================

def get_audio_duration(audio_path: str) -> float:
    """Get audio duration in seconds using ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", audio_path],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {audio_path}: {result.stderr}")
    duration_str = result.stdout.strip()
    if not duration_str:
        raise RuntimeError(f"ffprobe returned empty duration for {audio_path}")
    return float(duration_str)


def resolve_duration(audio_path: str, caller_duration: float | None) -> tuple[float, str | None]:
    """
    Resolve audio duration with validation.
    Returns (duration, warning_message).

    - Always auto-detects via ffprobe
    - If caller provided duration, warn if significantly different
    """
    detected = get_audio_duration(audio_path)
    warning = None

    if caller_duration is not None:
        diff = abs(detected - caller_duration)
        if diff > 1.0:  # More than 1 second difference
            warning = f"Caller duration ({caller_duration}s) differs from detected ({detected:.1f}s), using detected"

    return detected, warning


# ============================================================================
# Input Validation
# ============================================================================

def validate_inputs(action: str, params: dict) -> list[str]:
    """Validate required input files exist. Returns list of errors."""
    errors = []

    if action == "lipsync":
        portrait = params.get("portrait_image", "")
        audio = params.get("audio", "")

        # Portrait path: relative to input dir
        portrait_path = os.path.join(COMFYUI_INPUT, portrait)
        if not portrait:
            errors.append("Missing required parameter: portrait_image")
        elif not os.path.exists(portrait_path):
            errors.append(f"Portrait not found: {portrait_path}")

        # Audio path: relative to input dir
        audio_path = os.path.join(COMFYUI_INPUT, audio)
        if not audio:
            errors.append("Missing required parameter: audio")
        elif not os.path.exists(audio_path):
            errors.append(f"Audio not found: {audio_path}")

    elif action == "tts":
        voice_sample = params.get("voice_sample", "")
        text = params.get("text", "")

        if not text:
            errors.append("Missing required parameter: text")

        if voice_sample:
            sample_path = os.path.join(COMFYUI_INPUT, voice_sample)
            if not os.path.exists(sample_path):
                errors.append(f"Voice sample not found: {sample_path}")

    elif action == "portrait":
        # Portrait generation doesn't require input files
        pass

    return errors


# ============================================================================
# Symlinks & Setup
# ============================================================================

def setup_symlinks():
    """Create symlinks from /runpod-volume/* to /workspace/ComfyUI/*.

    Problem:
    - Network volume is mounted at /runpod-volume with models/inputs
    - Docker container has ComfyUI at /workspace/ComfyUI with empty dirs
    - ComfyUI expects models at /workspace/ComfyUI/models/

    Solution: Symlink /runpod-volume/<dir> -> /workspace/ComfyUI/models/<dir>
    """
    import shutil

    if not os.path.exists(NETWORK_VOLUME):
        log.warning(f"Network volume not found at {NETWORK_VOLUME}")
        return

    # Model directories: /runpod-volume/<dir> -> /workspace/ComfyUI/models/<dir>
    model_dirs = [
        "checkpoints", "video", "sonic", "f5_tts", "whisper",
        "controlnet", "loras", "vae", "clip", "clip_vision",
        "animatediff_models", "text_encoders"
    ]

    for model_dir in model_dirs:
        src = os.path.join(NETWORK_VOLUME, model_dir)
        dst = os.path.join(COMFYUI_MODELS, model_dir)

        if os.path.exists(src):
            # Remove Docker's empty dir if it exists and isn't already a symlink
            if os.path.exists(dst) and not os.path.islink(dst):
                if os.path.isdir(dst):
                    try:
                        os.rmdir(dst)  # Only removes if empty
                    except OSError:
                        shutil.rmtree(dst)  # Force remove if not empty

            # Create symlink if it doesn't exist
            if not os.path.exists(dst):
                os.symlink(src, dst)
                log.info(f"Linked model: {model_dir}")

    # SONIC expects whisper-tiny inside sonic folder, but it's provisioned separately
    # Since /workspace/ComfyUI/models/sonic -> /runpod-volume/sonic, we need to
    # create the symlink ON THE NETWORK VOLUME: /runpod-volume/sonic/whisper-tiny -> /runpod-volume/whisper/whisper-tiny
    whisper_src = os.path.join(NETWORK_VOLUME, "whisper", "whisper-tiny")
    sonic_on_volume = os.path.join(NETWORK_VOLUME, "sonic")
    whisper_dst = os.path.join(sonic_on_volume, "whisper-tiny")
    if os.path.exists(whisper_src) and os.path.exists(sonic_on_volume) and not os.path.exists(whisper_dst):
        os.symlink(whisper_src, whisper_dst)
        log.info("Linked whisper-tiny into sonic folder on network volume")

    # Input directories: /runpod-volume/<dir> -> /workspace/ComfyUI/input/<dir>
    input_dirs = ["voices", "avatars"]

    for input_dir in input_dirs:
        src = os.path.join(NETWORK_VOLUME, input_dir)
        dst = os.path.join(COMFYUI_INPUT, input_dir)

        if os.path.exists(src):
            # Remove Docker's empty dir
            if os.path.exists(dst) and not os.path.islink(dst):
                if os.path.isdir(dst):
                    try:
                        os.rmdir(dst)
                    except OSError:
                        shutil.rmtree(dst)

            if not os.path.exists(dst):
                os.symlink(src, dst)
                log.info(f"Linked input: {input_dir}")


def start_comfyui():
    """Start ComfyUI server in background."""
    global comfyui_process

    if comfyui_process is not None:
        return

    # Setup symlinks before starting (fixes Docker overlay issue)
    setup_symlinks()

    log.info(f"[{HANDLER_VERSION}] Starting ComfyUI server...")
    comfyui_process = subprocess.Popen(
        ["python", "main.py", "--listen", COMFYUI_HOST, "--port", str(COMFYUI_PORT)],
        cwd=COMFYUI_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT
    )

    # Wait for ComfyUI to be ready
    start_time = time.time()
    while time.time() - start_time < STARTUP_TIMEOUT:
        try:
            response = requests.get(f"{COMFYUI_URL}/system_stats", timeout=2)
            if response.status_code == 200:
                log.info(f"ComfyUI ready after {time.time() - start_time:.1f}s")
                return
        except requests.exceptions.RequestException:
            pass
        time.sleep(1)

    raise RuntimeError(f"ComfyUI failed to start within {STARTUP_TIMEOUT}s")


# ============================================================================
# ComfyUI API Helpers
# ============================================================================

def queue_prompt(workflow: dict) -> str:
    """Queue a workflow and return prompt ID."""
    response = requests.post(
        f"{COMFYUI_URL}/prompt",
        json={"prompt": workflow}
    )
    if response.status_code != 200:
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
    """Extract output file paths from history.

    Handles:
    - images: Standard image outputs
    - gifs: VHS_VideoCombine outputs (uses 'gifs' even for mp4)
    - videos: Other video nodes
    - audio: SaveAudioTensor and similar audio outputs
    """
    files = []
    outputs = history.get("outputs", {})

    for node_id, node_output in outputs.items():
        # Images
        if "images" in node_output:
            for img in node_output["images"]:
                files.append({
                    "type": "image",
                    "filename": img["filename"],
                    "subfolder": img.get("subfolder", ""),
                    "path": os.path.join(OUTPUT_DIR, img.get("subfolder", ""), img["filename"])
                })

        # Videos (VHS uses 'gifs' key even for mp4)
        if "gifs" in node_output:
            for gif in node_output["gifs"]:
                files.append({
                    "type": "video",
                    "filename": gif["filename"],
                    "subfolder": gif.get("subfolder", ""),
                    "path": os.path.join(OUTPUT_DIR, gif.get("subfolder", ""), gif["filename"])
                })

        # Some nodes use 'videos' key
        if "videos" in node_output:
            for vid in node_output["videos"]:
                files.append({
                    "type": "video",
                    "filename": vid["filename"],
                    "subfolder": vid.get("subfolder", ""),
                    "path": os.path.join(OUTPUT_DIR, vid.get("subfolder", ""), vid["filename"])
                })

        # Audio (SaveAudioTensor and similar)
        if "audio" in node_output:
            for aud in node_output["audio"]:
                files.append({
                    "type": "audio",
                    "filename": aud["filename"],
                    "subfolder": aud.get("subfolder", ""),
                    "path": os.path.join(OUTPUT_DIR, aud.get("subfolder", ""), aud["filename"])
                })

    return files


def cleanup_output_files(files: list[dict]):
    """Delete local output files after successful upload."""
    for f in files:
        try:
            path = f.get("path")
            if path and os.path.exists(path):
                os.remove(path)
                log.debug(f"Cleaned up: {path}")
        except OSError as e:
            log.warning(f"Failed to cleanup {f.get('path')}: {e}")


# ============================================================================
# File Handling
# ============================================================================

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

    content_type, _ = mimetypes.guess_type(local_path)
    if not content_type:
        content_type = "application/octet-stream"

    upload_url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{remote_path}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": content_type,
        "x-upsert": "true"
    }

    response = requests.post(upload_url, headers=headers, data=file_data)
    if response.status_code >= 400:
        # Capture actual error message from Supabase
        try:
            error_detail = response.json()
        except Exception:
            error_detail = response.text
        raise RuntimeError(f"Supabase upload failed ({response.status_code}): {error_detail}")

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


# ============================================================================
# Debug Info
# ============================================================================

def get_debug_info() -> dict:
    """Get debug info about volume, models, and ComfyUI status."""
    debug = {
        "version": HANDLER_VERSION,
        "network_volume_path": NETWORK_VOLUME,
        "network_volume_exists": os.path.exists(NETWORK_VOLUME),
        "network_volume_contents": [],
        "comfyui_dir_exists": os.path.exists(COMFYUI_DIR),
        "checkpoints_path": os.path.join(COMFYUI_MODELS, "checkpoints"),
        "checkpoints_exists": False,
        "checkpoints_contents": [],
        "sonic_path": os.path.join(COMFYUI_MODELS, "sonic"),
        "sonic_exists": False,
        "sonic_contents": [],
        "supabase_configured": supabase_enabled(),
        "comfyui_process_alive": comfyui_process is not None and comfyui_process.poll() is None,
    }

    if debug["network_volume_exists"]:
        try:
            debug["network_volume_contents"] = os.listdir(NETWORK_VOLUME)[:20]
        except Exception as e:
            debug["network_volume_contents"] = [f"Error: {e}"]

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

    # Check voices directory (on network volume)
    voices_volume = os.path.join(NETWORK_VOLUME, "voices")
    voices_comfyui = os.path.join(COMFYUI_INPUT, "voices")
    debug["voices_volume_path"] = voices_volume
    debug["voices_volume_exists"] = os.path.exists(voices_volume)
    debug["voices_comfyui_path"] = voices_comfyui
    debug["voices_comfyui_is_symlink"] = os.path.islink(voices_comfyui)
    if os.path.exists(voices_volume):
        try:
            debug["voices_contents"] = os.listdir(voices_volume)[:20]
        except Exception as e:
            debug["voices_contents"] = [f"Error: {e}"]
    else:
        debug["voices_contents"] = []

    # Check avatars directory (on network volume)
    avatars_volume = os.path.join(NETWORK_VOLUME, "avatars")
    avatars_comfyui = os.path.join(COMFYUI_INPUT, "avatars")
    debug["avatars_volume_path"] = avatars_volume
    debug["avatars_volume_exists"] = os.path.exists(avatars_volume)
    debug["avatars_comfyui_path"] = avatars_comfyui
    debug["avatars_comfyui_is_symlink"] = os.path.islink(avatars_comfyui)
    if os.path.exists(avatars_volume):
        try:
            debug["avatars_contents"] = os.listdir(avatars_volume)[:20]
        except Exception as e:
            debug["avatars_contents"] = [f"Error: {e}"]
    else:
        debug["avatars_contents"] = []

    # Check f5_tts directory
    f5_path = os.path.join(COMFYUI_MODELS, "f5_tts")
    debug["f5_tts_path"] = f5_path
    if os.path.exists(f5_path):
        debug["f5_tts_exists"] = True
        try:
            debug["f5_tts_contents"] = os.listdir(f5_path)[:20]
        except Exception as e:
            debug["f5_tts_contents"] = [f"Error: {e}"]
    else:
        debug["f5_tts_exists"] = False

    # Check video models
    video_path = os.path.join(COMFYUI_MODELS, "video")
    debug["video_path"] = video_path
    if os.path.exists(video_path):
        debug["video_exists"] = True
        try:
            debug["video_contents"] = os.listdir(video_path)[:20]
        except Exception as e:
            debug["video_contents"] = [f"Error: {e}"]
    else:
        debug["video_exists"] = False

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
    """Build F5-TTS workflow for voice cloning.

    Uses F5TTSAudioInputs (tensor-based) + LoadAudio for voice sample.
    Outputs via SaveAudioTensor.

    Matches src/workflows/tts.json structure.
    """
    text = params.get("text", "Hello world")
    voice_sample = params.get("voice_sample", "voices/sample.wav")
    sample_text = params.get("sample_text", "")  # Optional transcript of reference
    speed = params.get("speed", 1.0)
    seed = params.get("seed", -1)
    model = params.get("model", "F5TTS_v1_Base")
    vocoder = params.get("vocoder", "vocos")

    if seed == -1:
        seed = int.from_bytes(os.urandom(4), "big")

    return {
        "1": {
            "class_type": "LoadAudio",
            "inputs": {"audio": voice_sample}
        },
        "2": {
            "class_type": "F5TTSAudioInputs",
            "inputs": {
                "sample_audio": ["1", 0],
                "sample_text": sample_text,
                "speech": text,
                "seed": seed,
                "model": model,
                "vocoder": vocoder,
                "speed": speed,
                "model_type": "F5-TTS"
            }
        },
        "3": {
            "class_type": "SaveAudioTensor",
            "inputs": {
                "audio": ["2", 0],
                "filename_prefix": "ComfyUI_TTS"
            }
        }
    }


def build_lipsync_workflow(params: dict, audio_duration: float) -> dict:
    """Build SONIC lip-sync workflow.

    Matches the reference workflow from ComfyUI-SONIC wiki.
    All inputs are required for proper video output.

    Args:
        params: Workflow parameters
        audio_duration: Detected audio duration in seconds
    """
    portrait = params.get("portrait_image", "portrait.png")
    audio = params.get("audio", "speech.wav")
    svd_model = params.get("svd_checkpoint", "svd_xt_1_1.safetensors")
    sonic_unet = params.get("sonic_unet", "unet.pth")
    inference_steps = params.get("inference_steps", 25)
    fps = params.get("fps", 25.0)
    seed = params.get("seed", -1)

    if seed == -1:
        seed = int.from_bytes(os.urandom(4), "big")
    # Cap seed to 32-bit signed int max (ComfyUI limit)
    seed = seed % 2147483647

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
                "sonic_unet": sonic_unet,
                "ip_audio_scale": 1.0,
                "use_interframe": True,
                "dtype": "fp16"
            }
        },
        "5": {
            "class_type": "SONIC_PreData",
            "inputs": {
                "clip_vision": ["1", 1],
                "vae": ["1", 2],
                "audio": ["3", 0],
                "image": ["2", 0],
                "min_resolution": 512,
                "duration": audio_duration,
                "expand_ratio": 1,
                "weight_dtype": ["4", 1]  # Connect to SONICTLoader's DTYPE output
            }
        },
        "6": {
            "class_type": "SONICSampler",
            "inputs": {
                "model": ["4", 0],
                "data_dict": ["5", 0],
                "seed": seed,
                "randomize": "randomize",
                "inference_steps": inference_steps,
                "dynamic_scale": 1.0,
                "fps": fps
            }
        },
        "7": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["6", 0],
                "audio": ["3", 0],
                "frame_rate": ["6", 1],
                "loop_count": 0,
                "filename_prefix": "ComfyUI_LipSync",
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True
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
        input_data = event.get("input", {})
        action = input_data.get("action", "portrait")

        log.info(f"[{HANDLER_VERSION}] Processing action: {action}")

        # Setup symlinks FIRST (fixes Docker overlay hiding volume contents)
        setup_symlinks()

        # Handle non-workflow actions first
        if action == "health":
            return {
                "status": "healthy",
                "version": HANDLER_VERSION,
                "comfyui_url": COMFYUI_URL,
                "supabase_configured": supabase_enabled()
            }
        elif action == "debug":
            return get_debug_info()

        # Validate inputs (symlinks must exist first!)
        validation_errors = validate_inputs(action, input_data)
        if validation_errors:
            log.error(f"Validation failed: {validation_errors}")
            return {
                "status": "error",
                "version": HANDLER_VERSION,
                "action": action,
                "error": "Input validation failed",
                "validation_errors": validation_errors
            }

        # Ensure ComfyUI is running
        start_comfyui()

        # Build workflow with action-specific logic
        warnings = []

        if action == "portrait":
            workflow = build_portrait_workflow(input_data)

        elif action == "tts":
            workflow = build_tts_workflow(input_data)

        elif action == "lipsync":
            # Auto-detect audio duration
            audio_file = input_data.get("audio", "")
            audio_path = os.path.join(COMFYUI_INPUT, audio_file)

            caller_duration = input_data.get("duration")
            audio_duration, duration_warning = resolve_duration(audio_path, caller_duration)

            if duration_warning:
                warnings.append(duration_warning)
                log.warning(duration_warning)

            log.info(f"Audio duration: {audio_duration:.1f}s")
            workflow = build_lipsync_workflow(input_data, audio_duration)

        else:
            return {
                "status": "error",
                "version": HANDLER_VERSION,
                "error": f"Unknown action: {action}"
            }

        # Queue and wait for completion
        prompt_id = queue_prompt(workflow)
        log.info(f"Queued prompt: {prompt_id}")

        history = wait_for_completion(prompt_id)
        log.info("Workflow completed")

        # Check for execution errors
        status_info = history.get("status", {})
        status_str = status_info.get("status_str", "unknown")
        if status_str != "success":
            messages = status_info.get("messages", [])
            error_msg = f"Workflow failed with status: {status_str}"
            if messages:
                error_msg += f", messages: {messages}"
            log.error(error_msg)
            return {
                "status": "error",
                "version": HANDLER_VERSION,
                "action": action,
                "error": error_msg,
                "prompt_id": prompt_id,
                "raw_status": status_info,
                "raw_outputs": history.get("outputs", {})
            }

        # Get output files
        output_files = get_output_files(history)

        if not output_files:
            log.warning("No output files found in history")
            return {
                "status": "error",
                "version": HANDLER_VERSION,
                "action": action,
                "error": "Workflow produced no output files",
                "prompt_id": prompt_id,
                "raw_outputs": history.get("outputs", {})
            }

        # Handle save_to_avatars for portrait action - copy to avatars folder for lipsync use
        avatar_filename = None
        if action == "portrait" and input_data.get("save_to_avatars"):
            import shutil
            avatar_name = input_data.get("avatar_name", "generated_portrait.png")
            if not avatar_name.endswith(".png"):
                avatar_name += ".png"

            # Find the first image output
            for f in output_files:
                if f["type"] == "image" and os.path.exists(f["path"]):
                    avatar_dest = os.path.join(COMFYUI_INPUT, "avatars", avatar_name)
                    os.makedirs(os.path.dirname(avatar_dest), exist_ok=True)
                    shutil.copy2(f["path"], avatar_dest)
                    avatar_filename = f"avatars/{avatar_name}"
                    log.info(f"Saved portrait to avatars: {avatar_filename}")
                    break

        # Upload to Supabase if configured, otherwise return base64
        results = []
        use_supabase = supabase_enabled()

        for file_info in output_files:
            file_path = file_info["path"]

            if not os.path.exists(file_path):
                log.warning(f"Output file not found: {file_path}")
                continue

            file_size = os.path.getsize(file_path)

            result = {
                "type": file_info["type"],
                "filename": file_info["filename"]
            }

            if use_supabase:
                try:
                    today = date.today().isoformat()
                    unique_id = str(uuid.uuid4())[:8]
                    remote_path = f"outputs/{today}/{unique_id}/{file_info['filename']}"

                    upload_result = upload_to_supabase(file_path, remote_path)
                    result.update(upload_result)
                    log.info(f"Uploaded to Supabase: {remote_path}")
                except Exception as e:
                    log.error(f"Supabase upload failed, falling back to base64: {e}")
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

        # Cleanup output files after upload
        if use_supabase:
            cleanup_output_files(output_files)

        response = {
            "status": "success",
            "version": HANDLER_VERSION,
            "action": action,
            "files": results,
            "prompt_id": prompt_id,
            "storage": "supabase" if use_supabase else "base64"
        }

        if warnings:
            response["warnings"] = warnings

        # Include avatar path if saved for lipsync
        if avatar_filename:
            response["avatar_saved"] = avatar_filename
            response["lipsync_ready"] = True

        return response

    except Exception as e:
        log.exception(f"Handler error: {e}")
        return {
            "status": "error",
            "version": HANDLER_VERSION,
            "error": str(e)
        }


# Entry point
if __name__ == "__main__":
    log.info(f"Starting RunPod Serverless Handler {HANDLER_VERSION}")
    runpod.serverless.start({"handler": handler})
