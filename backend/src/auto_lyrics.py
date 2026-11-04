#!/usr/bin/env python3
"""
Ctrl Alt Lyrics - AI Auto-Sync & Auto-Generate Lyrics Engine
Utilizes stable-ts (Stable Whisper) with Apple Silicon MPS acceleration.
Supports:
  1. 'generate': Speech-to-text transcription of vocal audio to create timestamped lyrics lines.
  2. 'align': Audio-to-lyrics forced alignment of existing lyrics lines to vocal audio timestamps.
"""

import sys
import os
import json
import argparse
import traceback
import torch

def parse_args():
    parser = argparse.ArgumentParser(description="Ctrl Alt Lyrics - AI Whisper Engine")
    parser.add_argument("--action", required=True, choices=["generate", "align"], help="Action to execute")
    parser.add_argument("--audio", required=True, help="Path to vocal audio stem or track")
    parser.add_argument("--lyrics_json", default=None, help="Path to JSON file containing lyrics lines array (for align)")
    parser.add_argument("--model", default="small", help="Whisper model size: tiny, base, small, medium, turbo, large-v3, large-v2")
    parser.add_argument("--device", default=None, help="Device: mps, cuda, or cpu (auto-detected if None)")
    parser.add_argument("--language", default=None, help="Optional language code (auto-detected if None)")
    return parser.parse_args()

def log_progress(percent, stage, message):
    payload = {
        "percent": max(0, min(100, int(percent))),
        "stage": str(stage),
        "message": str(message)
    }
    print(f"PROGRESS: {json.dumps(payload)}", flush=True)

def resolve_device(requested_device):
    if requested_device:
        return requested_device
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"

def is_instrumental(text):
    if not text:
        return True
    t = text.strip().upper()
    return t in ["#INSTRUMENTAL", "[INSTRUMENTAL]", "(INSTRUMENTAL)", "INSTRUMENTAL"]

def ensure_model_available(model_name):
    """
    Ensures the requested Whisper model is present in ~/.cache/whisper and not corrupted.
    If missing or incomplete, downloads it while streaming real-time PROGRESS to stdout.
    """
    import whisper
    import hashlib
    import urllib.request
    import time

    if model_name not in whisper._MODELS:
        return

    url = whisper._MODELS[model_name]
    expected_sha256 = url.split("/")[-2]
    cache_dir = os.path.expanduser("~/.cache/whisper")
    os.makedirs(cache_dir, exist_ok=True)
    file_basename = os.path.basename(url)
    target_file = os.path.join(cache_dir, file_basename)
    temp_file = os.path.join(cache_dir, f"{file_basename}.downloading")

    # 1. If target file already exists, check integrity
    if os.path.isfile(target_file):
        try:
            size = os.path.getsize(target_file)
            if size > 10 * 1024 * 1024:  # > 10MB
                hasher = hashlib.sha256()
                with open(target_file, "rb") as f:
                    while chunk := f.read(1024 * 1024 * 4):  # 4MB chunks
                        hasher.update(chunk)
                if hasher.hexdigest() == expected_sha256:
                    return
        except Exception as e:
            print(f"Warning checking model {target_file}: {e}", file=sys.stderr)

        # Corrupt or incomplete file -> remove it
        try:
            os.remove(target_file)
        except Exception:
            pass

    # 2. Download model with live progress
    log_progress(1, "downloading", f"Downloading Whisper {model_name} model for first-time use...")

    initial_bytes = 0
    if os.path.isfile(temp_file):
        initial_bytes = os.path.getsize(temp_file)

    headers = {"User-Agent": "CtrlAltLyrics/1.0"}
    if initial_bytes > 0:
        headers["Range"] = f"bytes={initial_bytes}-"

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            code = resp.getcode()
            if code == 206:
                mode = "ab"
                total_size = initial_bytes + int(resp.info().get("Content-Length", 0))
                downloaded = initial_bytes
            else:
                mode = "wb"
                total_size = int(resp.info().get("Content-Length", 0))
                downloaded = 0

            total_mb = round(total_size / (1024 * 1024), 1) if total_size > 0 else 1420.0

            with open(temp_file, mode) as out:
                last_log_time = 0
                while True:
                    buf = resp.read(1024 * 64)
                    if not buf:
                        break
                    out.write(buf)
                    downloaded += len(buf)

                    now = time.time()
                    if now - last_log_time > 0.4:
                        last_log_time = now
                        pct = int((downloaded / total_size) * 100) if total_size > 0 else 50
                        scaled_pct = min(12, max(1, int(1 + (pct * 0.11))))
                        downloaded_mb = round(downloaded / (1024 * 1024), 1)
                        log_progress(
                            scaled_pct,
                            "downloading",
                            f"Downloading Whisper {model_name} model: {downloaded_mb}/{total_mb} MB ({pct}%)"
                        )

        # 3. Verify sha256
        hasher = hashlib.sha256()
        with open(temp_file, "rb") as f:
            while chunk := f.read(1024 * 1024 * 4):
                hasher.update(chunk)

        if hasher.hexdigest() == expected_sha256:
            if os.path.exists(target_file):
                os.remove(target_file)
            os.rename(temp_file, target_file)
            log_progress(12, "loading", f"Model {model_name} downloaded successfully.")
        else:
            if os.path.exists(temp_file):
                os.remove(temp_file)
            raise RuntimeError(f"Model SHA256 checksum mismatch for {model_name}. Please retry.")
    except Exception as e:
        raise RuntimeError(f"Failed to download Whisper {model_name} model: {e}. Check internet connection.")

def main():
    args = parse_args()

    audio_path = os.path.abspath(args.audio)
    if not os.path.isfile(audio_path):
        err_msg = f"Audio file not found: {audio_path}"
        print(json.dumps({"success": False, "error": err_msg}), flush=True)
        sys.exit(1)

    device = resolve_device(args.device)
    model_name = args.model or "small"
    lang = args.language if args.language and args.language.lower() not in ["", "auto", "none"] else None

    try:
        import stable_whisper
        import whisper.timing
        import stable_whisper.timing

        # Patch known upstream bug in openai-whisper where x.double() is called before x.cpu() on MPS tensors
        def safe_dtw(x):
            if hasattr(x, "cpu"):
                x = x.cpu()
            if hasattr(x, "double"):
                x = x.double()
            if hasattr(x, "numpy"):
                x = x.numpy()
            return whisper.timing.dtw_cpu(x)

        whisper.timing.dtw = safe_dtw
        stable_whisper.timing.dtw = safe_dtw
    except ImportError as e:
        err_msg = f"Failed to import stable_whisper: {e}"
        print(json.dumps({"success": False, "error": err_msg}), flush=True)
        sys.exit(1)

    # Ensure model file is completely downloaded and verified in cache before loading
    ensure_model_available(model_name)

    log_progress(12, "loading", f"Loading Whisper ({model_name}) on {device.upper()}...")

    try:
        model = stable_whisper.load_model(model_name, device=device)
    except Exception as e:
        # Fallback to cpu if mps had memory/kernel issue
        if device == "mps":
            log_progress(8, "loading", f"MPS load error ({e}), falling back to CPU...")
            device = "cpu"
            model = stable_whisper.load_model(model_name, device="cpu")
        else:
            raise e

    def make_progress_callback(base_pct, max_pct, stage_name):
        def _callback(cur, total):
            if total and total > 0:
                fraction = min(1.0, max(0.0, float(cur) / float(total)))
                pct = int(base_pct + fraction * (max_pct - base_pct))
                log_progress(pct, stage_name, f"Processing audio: {int(cur)}s / {int(total)}s ({pct}%)")
        return _callback

    # ---------------------------------------------------------
    # ACTION: GENERATE
    # ---------------------------------------------------------
    if args.action == "generate":
        log_progress(15, "transcribing", f"Transcribing vocal audio ({model_name})...")
        progress_cb = make_progress_callback(15, 85, "transcribing")

        result = model.transcribe(
            audio_path,
            language=lang,
            vad=False,
            regroup=True,
            suppress_silence=True,
            progress_callback=progress_cb
        )

        log_progress(90, "formatting", "Formatting lyric lines and timestamps...")
        generated_lines = []
        for seg in result.segments:
            raw_text = (seg.text or "").strip()
            if not raw_text:
                continue
            # Remove repeated empty spaces
            clean_text = " ".join(raw_text.split())
            if not clean_text:
                continue
            start_time = round(float(seg.start), 2)
            end_time = round(float(seg.end), 2)
            generated_lines.append({
                "time": start_time,
                "endTime": end_time,
                "text": clean_text,
                "translation": "",
                "transliteration": ""
            })

        detected_lang = getattr(result, "language", lang or "en")
        log_progress(100, "done", f"Generated {len(generated_lines)} lines ({detected_lang})")

        print(json.dumps({
            "success": True,
            "action": "generate",
            "model": model_name,
            "device": device,
            "language": detected_lang,
            "lines": generated_lines
        }), flush=True)
        return

    # ---------------------------------------------------------
    # ACTION: ALIGN
    # ---------------------------------------------------------
    if args.action == "align":
        if not args.lyrics_json or not os.path.isfile(args.lyrics_json):
            err_msg = f"Lyrics JSON file missing or invalid: {args.lyrics_json}"
            print(json.dumps({"success": False, "error": err_msg}), flush=True)
            sys.exit(1)

        with open(args.lyrics_json, "r", encoding="utf-8") as f:
            raw_data = json.load(f)

        if isinstance(raw_data, dict):
            original_lines = raw_data.get("lyrics", [])
        elif isinstance(raw_data, list):
            original_lines = raw_data
        else:
            original_lines = []

        if not isinstance(original_lines, list) or len(original_lines) == 0:
            print(json.dumps({"success": False, "error": "No lyrics lines found to align"}), flush=True)
            sys.exit(1)

        # Separate instrumental/blank lines from lyric lines
        speech_indices = []
        speech_texts = []
        for idx, line in enumerate(original_lines):
            t = (line.get("text") or "").strip()
            if t and not is_instrumental(t):
                speech_indices.append(idx)
                speech_texts.append(t)

        if not speech_texts:
            print(json.dumps({"success": False, "error": "No vocal lyrics lines to align (all instrumental/empty)"}), flush=True)
            sys.exit(1)

        # Detect language if not provided
        if not lang:
            try:
                import whisper
                audio_snippet = whisper.load_audio(audio_path)
                audio_snippet = whisper.pad_or_trim(audio_snippet)
                mel = whisper.log_mel_spectrogram(audio_snippet, n_mels=model.dims.n_mels).to(model.device)
                _, probs = model.detect_language(mel)
                lang = max(probs, key=probs.get)
                log_progress(12, "detected_lang", f"Auto-detected audio language: '{lang}'")
            except Exception as e:
                lang = "en"

        log_progress(15, "aligning", f"Aligning {len(speech_texts)} lyric lines ({lang}) to audio...")
        progress_cb = make_progress_callback(15, 85, "aligning")

        joined_lyrics = "\n".join(speech_texts)

        try:
            aligned_result = model.align(
                audio_path,
                joined_lyrics,
                language=lang,
                original_split=True,
                progress_callback=progress_cb
            )
        except Exception as e:
            # If original_split fails or has token issue, retry without original_split
            log_progress(30, "aligning", f"Refining alignment ({e})...")
            aligned_result = model.align(
                audio_path,
                joined_lyrics,
                language=lang,
                original_split=False,
                progress_callback=progress_cb
            )

        log_progress(90, "mapping", "Mapping timestamps back to original lyrics...")

        aligned_segments = aligned_result.segments if aligned_result else []

        # Map timestamps back to speech lines
        num_aligned = min(len(speech_indices), len(aligned_segments))
        for i in range(num_aligned):
            orig_idx = speech_indices[i]
            seg = aligned_segments[i]
            original_lines[orig_idx]["time"] = round(float(seg.start), 2)
            original_lines[orig_idx]["endTime"] = round(float(seg.end), 2)

        # For any unmapped speech lines at the tail, extrapolate smoothly
        if len(speech_indices) > num_aligned:
            last_time = original_lines[speech_indices[num_aligned - 1]]["time"] if num_aligned > 0 else 0.0
            for i in range(num_aligned, len(speech_indices)):
                orig_idx = speech_indices[i]
                last_time += 3.0
                original_lines[orig_idx]["time"] = round(last_time, 2)

        detected_lang = getattr(aligned_result, "language", lang or "en")
        log_progress(100, "done", f"Aligned {len(original_lines)} lines ({detected_lang})")

        print(json.dumps({
            "success": True,
            "action": "align",
            "model": model_name,
            "device": device,
            "language": detected_lang,
            "lines": original_lines
        }), flush=True)
        return

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": False, "error": str(exc)}), flush=True)
        sys.exit(1)
