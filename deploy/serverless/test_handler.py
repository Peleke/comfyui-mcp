"""
Tests for RunPod Serverless Handler

Run with: python -m pytest test_handler.py -v
"""

import pytest
from unittest.mock import patch, MagicMock
import os
import sys

# Import handler components
from handler import (
    build_lipsync_workflow,
    build_portrait_workflow,
    build_tts_workflow,
    validate_inputs,
    get_audio_duration,
    resolve_duration,
    get_output_files,
    cleanup_output_files,
    HANDLER_VERSION,
    COMFYUI_INPUT,
    OUTPUT_DIR,
)


class TestVersioning:
    """Test version tracking."""

    def test_version_is_set(self):
        assert HANDLER_VERSION.startswith("v")
        assert len(HANDLER_VERSION) >= 2

    def test_version_is_v34(self):
        assert HANDLER_VERSION == "v34"


class TestAudioDuration:
    """Test audio duration detection."""

    @patch("subprocess.run")
    def test_gets_duration_from_ffprobe(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="10.5\n", stderr="")
        duration = get_audio_duration("/path/to/audio.wav")
        assert duration == 10.5

    @patch("subprocess.run")
    def test_raises_on_ffprobe_failure(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="error")
        with pytest.raises(RuntimeError, match="ffprobe failed"):
            get_audio_duration("/path/to/audio.wav")

    @patch("subprocess.run")
    def test_raises_on_empty_duration(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        with pytest.raises(RuntimeError, match="empty duration"):
            get_audio_duration("/path/to/audio.wav")

    @patch("handler.get_audio_duration")
    def test_resolve_duration_uses_detected(self, mock_get_duration):
        mock_get_duration.return_value = 15.0
        duration, warning = resolve_duration("/path/to/audio.wav", None)
        assert duration == 15.0
        assert warning is None

    @patch("handler.get_audio_duration")
    def test_resolve_duration_warns_on_mismatch(self, mock_get_duration):
        mock_get_duration.return_value = 15.0
        duration, warning = resolve_duration("/path/to/audio.wav", 10.0)
        assert duration == 15.0
        assert warning is not None
        assert "differs from detected" in warning

    @patch("handler.get_audio_duration")
    def test_resolve_duration_no_warning_on_close_match(self, mock_get_duration):
        mock_get_duration.return_value = 10.5
        duration, warning = resolve_duration("/path/to/audio.wav", 10.0)
        assert duration == 10.5
        assert warning is None  # Within 1 second tolerance


class TestInputValidation:
    """Test input validation."""

    @patch("os.path.exists")
    def test_validates_lipsync_missing_files(self, mock_exists):
        mock_exists.return_value = False
        errors = validate_inputs("lipsync", {
            "portrait_image": "missing.png",
            "audio": "missing.wav"
        })
        assert len(errors) == 2
        assert any("Portrait not found" in e for e in errors)
        assert any("Audio not found" in e for e in errors)

    @patch("os.path.exists")
    def test_validates_lipsync_missing_params(self, mock_exists):
        errors = validate_inputs("lipsync", {})
        assert len(errors) == 2
        assert any("Missing required parameter: portrait_image" in e for e in errors)
        assert any("Missing required parameter: audio" in e for e in errors)

    @patch("os.path.exists")
    def test_passes_when_files_exist(self, mock_exists):
        mock_exists.return_value = True
        errors = validate_inputs("lipsync", {
            "portrait_image": "exists.png",
            "audio": "exists.wav"
        })
        assert len(errors) == 0

    def test_validates_tts_missing_text(self):
        errors = validate_inputs("tts", {})
        assert len(errors) == 1
        assert "Missing required parameter: text" in errors[0]

    def test_tts_passes_with_text(self):
        errors = validate_inputs("tts", {"text": "Hello world"})
        assert len(errors) == 0

    @patch("os.path.exists")
    def test_tts_validates_voice_sample_exists(self, mock_exists):
        mock_exists.return_value = False
        errors = validate_inputs("tts", {
            "text": "Hello",
            "voice_sample": "voices/missing.wav"
        })
        assert len(errors) == 1
        assert "Voice sample not found" in errors[0]

    def test_portrait_requires_no_files(self):
        errors = validate_inputs("portrait", {})
        assert len(errors) == 0


class TestLipsyncWorkflow:
    """Test lipsync workflow builder."""

    def test_includes_all_sonic_inputs(self):
        workflow = build_lipsync_workflow({
            "portrait_image": "portrait.png",
            "audio": "speech.wav",
        }, audio_duration=10.0)

        # Check SONICTLoader has required inputs
        assert workflow["4"]["inputs"]["ip_audio_scale"] == 1.0
        assert workflow["4"]["inputs"]["use_interframe"] == True
        assert workflow["4"]["inputs"]["dtype"] == "fp16"

        # Check SONIC_PreData has required inputs
        assert workflow["5"]["inputs"]["min_resolution"] == 512
        assert workflow["5"]["inputs"]["duration"] == 10.0  # Uses passed duration
        assert workflow["5"]["inputs"]["expand_ratio"] == 1

        # Check VHS_VideoCombine has format
        assert workflow["7"]["inputs"]["format"] == "video/h264-mp4"
        assert workflow["7"]["inputs"]["save_output"] == True

    def test_uses_provided_duration(self):
        workflow = build_lipsync_workflow({}, audio_duration=25.5)
        assert workflow["5"]["inputs"]["duration"] == 25.5

    def test_generates_seed_when_negative(self):
        workflow = build_lipsync_workflow({"seed": -1}, audio_duration=10)
        seed = workflow["6"]["inputs"]["seed"]
        assert seed >= 0
        assert isinstance(seed, int)

    def test_uses_provided_seed(self):
        workflow = build_lipsync_workflow({"seed": 12345}, audio_duration=10)
        assert workflow["6"]["inputs"]["seed"] == 12345

    def test_default_model_paths(self):
        workflow = build_lipsync_workflow({}, audio_duration=10)
        assert workflow["1"]["inputs"]["ckpt_name"] == "video/svd_xt_1_1.safetensors"
        assert workflow["4"]["inputs"]["sonic_unet"] == "unet.pth"


class TestTTSWorkflow:
    """Test TTS workflow builder."""

    def test_uses_correct_nodes(self):
        workflow = build_tts_workflow({"text": "Hello world"})

        # Should use LoadAudio + F5TTSAudioInputs + SaveAudioTensor
        assert workflow["1"]["class_type"] == "LoadAudio"
        assert workflow["2"]["class_type"] == "F5TTSAudioInputs"
        assert workflow["3"]["class_type"] == "SaveAudioTensor"

    def test_saves_audio_output(self):
        workflow = build_tts_workflow({"text": "Test"})
        # Verify SaveAudioTensor is connected correctly
        assert workflow["3"]["inputs"]["audio"] == ["2", 0]
        assert "filename_prefix" in workflow["3"]["inputs"]

    def test_connects_sample_audio(self):
        workflow = build_tts_workflow({
            "text": "Hello",
            "voice_sample": "voices/myvoice.wav"
        })
        assert workflow["1"]["inputs"]["audio"] == "voices/myvoice.wav"
        assert workflow["2"]["inputs"]["sample_audio"] == ["1", 0]

    def test_default_model_settings(self):
        workflow = build_tts_workflow({"text": "Test"})
        assert workflow["2"]["inputs"]["model"] == "F5TTS_v1_Base"
        assert workflow["2"]["inputs"]["vocoder"] == "vocos"
        assert workflow["2"]["inputs"]["model_type"] == "F5-TTS"


class TestPortraitWorkflow:
    """Test portrait workflow builder."""

    def test_basic_structure(self):
        workflow = build_portrait_workflow({"description": "A portrait"})

        # Check essential nodes exist
        assert "3" in workflow  # KSampler
        assert "4" in workflow  # CheckpointLoader
        assert "9" in workflow  # SaveImage

        assert workflow["3"]["class_type"] == "KSampler"
        assert workflow["4"]["class_type"] == "CheckpointLoaderSimple"
        assert workflow["9"]["class_type"] == "SaveImage"

    def test_uses_description_as_prompt(self):
        workflow = build_portrait_workflow({"description": "A test portrait"})
        assert workflow["6"]["inputs"]["text"] == "A test portrait"

    def test_uses_prompt_over_description(self):
        workflow = build_portrait_workflow({
            "description": "Description text",
            "prompt": "Prompt text"
        })
        assert workflow["6"]["inputs"]["text"] == "Prompt text"


class TestOutputExtraction:
    """Test output file extraction from history."""

    def test_extracts_gifs_as_video(self):
        history = {
            "outputs": {
                "7": {
                    "gifs": [{"filename": "video.mp4", "subfolder": "", "type": "output"}]
                }
            }
        }
        files = get_output_files(history)
        assert len(files) == 1
        assert files[0]["type"] == "video"
        assert files[0]["filename"] == "video.mp4"

    def test_extracts_videos_key(self):
        history = {
            "outputs": {
                "7": {
                    "videos": [{"filename": "output.mp4", "subfolder": "", "type": "output"}]
                }
            }
        }
        files = get_output_files(history)
        assert len(files) == 1
        assert files[0]["type"] == "video"

    def test_extracts_images(self):
        history = {
            "outputs": {
                "9": {
                    "images": [{"filename": "portrait.png", "subfolder": ""}]
                }
            }
        }
        files = get_output_files(history)
        assert len(files) == 1
        assert files[0]["type"] == "image"

    def test_extracts_audio(self):
        history = {
            "outputs": {
                "3": {
                    "audio": [{"filename": "speech.wav", "subfolder": ""}]
                }
            }
        }
        files = get_output_files(history)
        assert len(files) == 1
        assert files[0]["type"] == "audio"

    def test_handles_subfolder(self):
        history = {
            "outputs": {
                "7": {
                    "gifs": [{"filename": "video.mp4", "subfolder": "lipsync"}]
                }
            }
        }
        files = get_output_files(history)
        assert "lipsync" in files[0]["path"]

    def test_handles_empty_outputs(self):
        history = {"outputs": {}}
        files = get_output_files(history)
        assert files == []

    def test_handles_multiple_outputs(self):
        history = {
            "outputs": {
                "7": {
                    "gifs": [{"filename": "video.mp4", "subfolder": ""}]
                },
                "9": {
                    "images": [{"filename": "thumb.png", "subfolder": ""}]
                }
            }
        }
        files = get_output_files(history)
        assert len(files) == 2


class TestCleanup:
    """Test output file cleanup."""

    @patch("os.path.exists")
    @patch("os.remove")
    def test_removes_existing_files(self, mock_remove, mock_exists):
        mock_exists.return_value = True
        files = [{"path": "/workspace/ComfyUI/output/test.mp4"}]
        cleanup_output_files(files)
        mock_remove.assert_called_once_with("/workspace/ComfyUI/output/test.mp4")

    @patch("os.path.exists")
    @patch("os.remove")
    def test_skips_nonexistent_files(self, mock_remove, mock_exists):
        mock_exists.return_value = False
        files = [{"path": "/workspace/ComfyUI/output/missing.mp4"}]
        cleanup_output_files(files)
        mock_remove.assert_not_called()

    @patch("os.path.exists")
    @patch("os.remove")
    def test_handles_remove_error(self, mock_remove, mock_exists):
        mock_exists.return_value = True
        mock_remove.side_effect = OSError("Permission denied")
        files = [{"path": "/workspace/ComfyUI/output/locked.mp4"}]
        # Should not raise
        cleanup_output_files(files)


class TestPathConfiguration:
    """Test path configuration."""

    def test_comfyui_paths(self):
        assert COMFYUI_INPUT == "/workspace/ComfyUI/input"
        assert OUTPUT_DIR == "/workspace/ComfyUI/output"

    def test_network_volume_path(self):
        from handler import NETWORK_VOLUME
        assert NETWORK_VOLUME == "/runpod-volume"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
