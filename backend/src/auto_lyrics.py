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
import numpy as np

def parse_args():
    parser = argparse.ArgumentParser(description="Ctrl Alt Lyrics - AI Whisper Engine")
    parser.add_argument("--action", required=True, choices=["generate", "align", "download"], help="Action to execute")
    parser.add_argument("--audio", default=None, help="Path to vocal audio stem or track")
    parser.add_argument("--lyrics_json", default=None, help="Path to JSON file containing lyrics lines array (for align)")
    parser.add_argument("--model", default="small", help="Whisper model size: tiny, base, small, medium, turbo, large-v3, large-v2")
    parser.add_argument("--device", default=None, help="Device: mps, cuda, or cpu (auto-detected if None)")
    parser.add_argument("--language", default=None, help="Optional language code (auto-detected if None)")
    parser.add_argument("--precision", default="word", choices=["word", "line"], help="Sync precision: word (sub-line word timestamps, pause detection, instrumental parts) or line")
    parser.add_argument("--pause_threshold", type=float, default=0.8, help="Minimum gap (in seconds) between words to register as a vocal pause (default: 0.8s)")
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
    return t in ["#INSTRUMENTAL", "[INSTRUMENTAL]", "(INSTRUMENTAL)", "INSTRUMENTAL", "🎵🎵🎵"]

class AudioEnergyProfile:
    """
    Vectorized NumPy RMS and acoustic silence detector for vocal stems/audio tracks.
    Computes 20ms RMS frames with 100ms smoothing and adaptive silence floor estimation.
    Zero network dependencies; runs in ~2-3ms on raw audio frames.
    """
    def __init__(self, audio_path, sample_rate=16000, frame_ms=20, win_ms=40, smooth_ms=100):
        import whisper
        self.sample_rate = sample_rate
        self.hop_size = int(sample_rate * (frame_ms / 1000.0))
        self.win_size = int(sample_rate * (win_ms / 1000.0))
        self.frame_step_sec = frame_ms / 1000.0

        audio = whisper.load_audio(audio_path)
        self.audio_len_sec = len(audio) / sample_rate

        # Vectorized frame slicing & RMS calculation
        num_frames = max(1, (len(audio) - self.win_size) // self.hop_size + 1)
        frames = np.lib.stride_tricks.as_strided(
            audio,
            shape=(num_frames, self.win_size),
            strides=(audio.strides[0] * self.hop_size, audio.strides[0])
        )
        raw_rms = np.sqrt(np.mean(frames ** 2, axis=1))

        # Vectorized uniform moving average smoothing
        k = max(1, int(smooth_ms / frame_ms))
        if k > 1:
            pad_left = k // 2
            pad_right = k - 1 - pad_left
            padded = np.pad(raw_rms, (pad_left, pad_right), mode="edge")
            cumsum = np.cumsum(np.insert(padded, 0, 0))
            self.rms = (cumsum[k:] - cumsum[:-k]) / float(k)
        else:
            self.rms = raw_rms

        # Adaptive silence floor:
        # In isolated vocal stems, background noise floor is ~0.001-0.012, active singing is ~0.04-0.30
        p25 = float(np.percentile(self.rms, 25))
        self.silence_floor = max(0.015, min(0.028, p25 * 1.5))
        self.is_silent = self.rms < self.silence_floor

    def time_to_idx(self, t):
        return max(0, min(len(self.rms) - 1, int(round(t / self.frame_step_sec))))

    def idx_to_time(self, idx):
        return round(idx * self.frame_step_sec, 2)

    def get_stats(self, t1, t2):
        i1 = self.time_to_idx(t1)
        i2 = max(i1 + 1, self.time_to_idx(t2))
        seg_rms = self.rms[i1:i2]
        seg_silent = self.is_silent[i1:i2]

        mean_rms = float(np.mean(seg_rms))
        max_rms = float(np.max(seg_rms))
        silent_pct = float(np.mean(seg_silent))

        best_start, best_len = None, 0
        cur_start, cur_len = None, 0
        for i, s in enumerate(seg_silent):
            if s:
                if cur_start is None:
                    cur_start = i
                cur_len += 1
            else:
                if cur_start is not None and cur_len > best_len:
                    best_len = cur_len
                    best_start = cur_start
                cur_start = None
                cur_len = 0
        if cur_start is not None and cur_len > best_len:
            best_len = cur_len
            best_start = cur_start

        continuous_silence = None
        if best_start is not None:
            sil_dur = best_len * self.frame_step_sec
            if sil_dur >= 0.35:
                s_t = round(self.idx_to_time(i1 + best_start), 2)
                e_t = round(s_t + sil_dur, 2)
                continuous_silence = (s_t, e_t, round(sil_dur, 2))

        return {
            "mean_rms": mean_rms,
            "max_rms": max_rms,
            "silent_pct": silent_pct,
            "continuous_silence": continuous_silence
        }

    def find_vocal_end(self, start_t, max_lookahead_sec=4.0):
        start_idx = self.time_to_idx(start_t)
        max_idx = min(len(self.rms), start_idx + int(max_lookahead_sec / self.frame_step_sec))
        last_vocal_idx = start_idx
        silence_run = 0
        for i in range(start_idx, max_idx):
            if not self.is_silent[i]:
                last_vocal_idx = i
                silence_run = 0
            else:
                silence_run += 1
                if silence_run >= int(0.5 / self.frame_step_sec):
                    break
        return self.idx_to_time(last_vocal_idx)

def build_sync_points_and_detect_pauses(line_text, raw_words, pause_threshold=0.8, energy_profile=None):
    """
    Given line text and WordTiming objects from stable-whisper,
    computes accurate charIndex offsets, detects in-line pauses, and builds syncPoints.
    When energy_profile is provided:
      1. Binds intra-line word leaps across multi-second instrumental breaks (> 2.5s)
      2. Trims trailing silence from words that Whisper over-extended into pauses
      3. Repositions collapsed pre-pause words into active vocal phonation
      4. Ground pause placement strictly in acoustic silence (RMS < silence floor)
    """
    if not raw_words:
        return []

    words = []
    for w in raw_words:
        txt = (getattr(w, "word", None) or ((w.get("word") or w.get("text")) if isinstance(w, dict) else "") or "").strip()
        if not txt:
            continue
        start_t = float(getattr(w, "start", None) if hasattr(w, "start") else (w.get("start", 0.0) if isinstance(w, dict) else 0.0))
        end_t = float(getattr(w, "end", None) if hasattr(w, "end") else (w.get("end", 0.0) if isinstance(w, dict) else 0.0))
        words.append({
            "text": txt,
            "start": round(start_t, 2),
            "end": round(max(start_t + 0.1, end_t), 2)
        })

    if not words:
        return []

    if energy_profile is not None:
        # Step 1: Prevent intra-line word leaps across multi-second instrumental breaks (> 2.5s)
        for i in range(1, len(words)):
            prev_end = words[i - 1]["end"]
            cur_start = words[i]["start"]
            gap = cur_start - prev_end
            if gap > 2.5:
                vocal_end = energy_profile.find_vocal_end(prev_end, max_lookahead_sec=min(gap, 5.0))
                if cur_start - vocal_end >= 1.5:
                    words[i]["start"] = round(prev_end, 2)
                    words[i]["end"] = round(max(prev_end + 0.4, vocal_end), 2)

        # Step 2: Trim trailing silence from words where Whisper over-extended into a pause
        for i in range(len(words)):
            w = words[i]
            dur = w["end"] - w["start"]
            if dur >= 0.7:
                stats = energy_profile.get_stats(w["start"], w["end"])
                sil = stats["continuous_silence"]
                if sil and sil[2] >= 0.40 and sil[0] >= (w["start"] + 0.20):
                    w["end"] = sil[0]

        # Step 3: Reposition collapsed words (< 0.35s) if Whisper collapsed them before/after a gap with vocal energy
        for i in range(len(words)):
            w = words[i]
            prev_end = words[i - 1]["end"] if i > 0 else None
            if prev_end is not None and w["start"] > prev_end:
                gap = w["start"] - prev_end
                stats = energy_profile.get_stats(prev_end, w["start"])
                dur = w["end"] - w["start"]
                if dur <= 0.35 and stats["mean_rms"] > energy_profile.silence_floor:
                    sil_span = stats["continuous_silence"]
                    if sil_span and sil_span[2] >= 0.45:
                        sil_start, sil_end, sil_dur = sil_span
                        if sil_start > prev_end + 0.15:
                            w["start"] = prev_end
                            w["end"] = sil_start
                    else:
                        w["start"] = prev_end

        # Step 4: Monotonicity and boundary ordering
        for i in range(len(words)):
            if i > 0 and words[i]["start"] < words[i - 1]["start"]:
                words[i - 1], words[i] = words[i], words[i - 1]
            if words[i]["end"] <= words[i]["start"]:
                words[i]["end"] = round(words[i]["start"] + 0.1, 2)

    # Step 5: Build sync points with acoustic pause verification
    sync_points = []
    line_clean = line_text or ""
    search_pos = 0
    prev_end = None
    prev_char_end = 0

    for idx, w in enumerate(words):
        w_text = w["text"]
        w_start = w["start"]
        w_end = w["end"]

        if prev_end is not None and w_start < prev_end:
            w_start = prev_end
            if w_end <= w_start:
                w_end = round(w_start + 0.1, 2)

        # Match charIndex in line_clean starting from search_pos
        pos = line_clean.find(w_text, search_pos)
        if pos == -1:
            pos = line_clean.lower().find(w_text.lower(), search_pos)
        if pos == -1:
            pos = search_pos

        if prev_end is not None:
            gap = round(w_start - prev_end, 2)
            if gap >= pause_threshold:
                is_genuine_pause = True
                sil_start = prev_end
                sil_end = w_start

                if energy_profile is not None:
                    stats = energy_profile.get_stats(prev_end, w_start)
                    sil_span = stats["continuous_silence"]
                    if stats["silent_pct"] >= 0.35 and sil_span is not None and sil_span[2] >= 0.45:
                        sil_start, sil_end, sil_dur = sil_span
                        if w_start > sil_end and (w_start - sil_end) < 0.4:
                            sil_end = w_start
                    else:
                        is_genuine_pause = False
                        prev_end = w_start

                if is_genuine_pause:
                    pause_dur = round(sil_end - sil_start, 2)
                    if pause_dur >= 0.5:
                        if sync_points:
                            sync_points[-1]["endTime"] = round(sil_start, 2)
                    w_start = max(sil_end, w_start)
                    w_end = max(w_start + 0.1, w_end)

        # Default word timestamp is 'time'. Optional 'endTime' is set for pauses or line tail.
        pt = {
            "charIndex": pos,
            "time": round(w_start, 2),
            "text": w_text
        }
        if idx == len(words) - 1:
            pt["endTime"] = round(w_end, 2)
        sync_points.append(pt)
        search_pos = pos + len(w_text)
        prev_char_end = search_pos
        prev_end = w_end

    return sync_points

def insert_instrumental_parts(lines, min_gap=4.0):
    """
    Ensures #INSTRUMENTAL lines cleanly bridge intro, interludes, and outros:
    1. Updates any existing #INSTRUMENTAL lines to match aligned speech boundaries.
    2. Inserts new #INSTRUMENTAL lines for large gaps (>= min_gap) between speech lines
       or for a long intro before the first speech line.
    """
    if not lines:
        return lines

    # 1. Update existing instrumental lines to cleanly bridge surrounding speech lines
    for i, line in enumerate(lines):
        line_is_inst = is_instrumental(line.get("text")) or line.get("isInstrumental")
        if line_is_inst:
            prev_speech = None
            for p in range(i - 1, -1, -1):
                if not (is_instrumental(lines[p].get("text")) or lines[p].get("isInstrumental")):
                    prev_speech = lines[p]
                    break
            next_speech = None
            for n in range(i + 1, len(lines)):
                if not (is_instrumental(lines[n].get("text")) or lines[n].get("isInstrumental")):
                    next_speech = lines[n]
                    break

            if prev_speech is None and next_speech is not None:
                # Song intro
                nxt_start = float(next_speech.get("time", 0.0) or 0.0)
                line["time"] = 0.0
                line["endTime"] = max(0.0, round(nxt_start - 0.2, 2))
                line["isInstrumental"] = True
            elif prev_speech is not None and next_speech is not None:
                # Interlude between speech lines
                p_end = float(prev_speech.get("endTime") or (prev_speech.get("time", 0.0) + 3.0))
                n_start = float(next_speech.get("time", 0.0) or 0.0)
                line["time"] = round(p_end + 0.3, 2)
                line["endTime"] = max(line["time"], round(n_start - 0.3, 2))
                line["isInstrumental"] = True
            elif prev_speech is not None and next_speech is None:
                # Outro
                p_end = float(prev_speech.get("endTime") or (prev_speech.get("time", 0.0) + 3.0))
                line["time"] = round(p_end + 0.3, 2)
                if not line.get("endTime") or float(line["endTime"]) < line["time"]:
                    line["endTime"] = round(line["time"] + 5.0, 2)
                line["isInstrumental"] = True

    # 2. Insert new #INSTRUMENTAL lines where gap >= min_gap and none exists
    result = []
    first_line = lines[0]
    first_is_inst = is_instrumental(first_line.get("text")) or first_line.get("isInstrumental")
    first_time = float(first_line.get("time", 0.0) or 0.0)
    if not first_is_inst and first_time >= min_gap:
        result.append({
            "time": 0.0,
            "endTime": round(first_time - 0.2, 2),
            "text": "#INSTRUMENTAL",
            "isInstrumental": True,
            "translation": "",
            "transliteration": ""
        })

    for i, curr in enumerate(lines):
        result.append(curr)
        if i < len(lines) - 1:
            nxt = lines[i + 1]
            curr_is_inst = is_instrumental(curr.get("text")) or curr.get("isInstrumental")
            nxt_is_inst = is_instrumental(nxt.get("text")) or nxt.get("isInstrumental")

            if not curr_is_inst and not nxt_is_inst:
                curr_end = float(curr.get("endTime") or (curr.get("time", 0.0) + 3.0))
                nxt_start = float(nxt.get("time", 0.0) or 0.0)
                gap = nxt_start - curr_end
                if gap >= min_gap:
                    result.append({
                        "time": round(curr_end + 0.3, 2),
                        "endTime": round(nxt_start - 0.3, 2),
                        "text": "#INSTRUMENTAL",
                        "isInstrumental": True,
                        "translation": "",
                        "transliteration": ""
                    })

    return result

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
    model_name = args.model or "small"

    if args.action == "download":
        ensure_model_available(model_name)
        log_progress(100, "done", f"Whisper {model_name} model is downloaded and verified.")
        print(json.dumps({"success": True, "action": "download", "model": model_name}), flush=True)
        return

    if not args.audio:
        err_msg = "Audio file required for align and generate actions"
        print(json.dumps({"success": False, "error": err_msg}), flush=True)
        sys.exit(1)

    audio_path = os.path.abspath(args.audio)
    if not os.path.isfile(audio_path):
        err_msg = f"Audio file not found: {audio_path}"
        print(json.dumps({"success": False, "error": err_msg}), flush=True)
        sys.exit(1)

    device = resolve_device(args.device)
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

    # Compute acoustic energy profile of vocal audio track for silence & pause verification
    energy_profile = None
    try:
        log_progress(13, "analyzing", "Profiling acoustic vocal energy...")
        energy_profile = AudioEnergyProfile(audio_path)
    except Exception as e:
        print(f"Warning building audio energy profile: {e}", file=sys.stderr)

    log_progress(14, "loading", f"Loading Whisper ({model_name}) on {device.upper()}...")

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
            line_data = {
                "time": start_time,
                "endTime": end_time,
                "text": clean_text,
                "translation": "",
                "transliteration": ""
            }
            if args.precision == "word":
                words = getattr(seg, "words", None) or []
                sync_pts = build_sync_points_and_detect_pauses(clean_text, words, pause_threshold=args.pause_threshold, energy_profile=energy_profile)
                if sync_pts:
                    line_data["syncPoints"] = sync_pts
                    word_pts = [p for p in sync_pts if not p.get("isPause")]
                    if word_pts:
                        line_data["time"] = word_pts[0]["time"]
                        line_data["endTime"] = word_pts[-1].get("endTime", round(word_pts[-1]["time"] + 2.0, 2))
            generated_lines.append(line_data)

        if args.precision == "word":
            generated_lines = insert_instrumental_parts(generated_lines)

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
                only_voice_freq=True,
                remove_instant_words=True,
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
                only_voice_freq=True,
                remove_instant_words=True,
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
            if args.precision == "word":
                words = getattr(seg, "words", None) or []
                sync_pts = build_sync_points_and_detect_pauses(
                    original_lines[orig_idx].get("text"),
                    words,
                    pause_threshold=args.pause_threshold,
                    energy_profile=energy_profile
                )
                if sync_pts:
                    original_lines[orig_idx]["syncPoints"] = sync_pts
                    word_pts = [p for p in sync_pts if not p.get("isPause")]
                    if word_pts:
                        original_lines[orig_idx]["time"] = word_pts[0]["time"]
                        original_lines[orig_idx]["endTime"] = word_pts[-1].get("endTime", round(word_pts[-1]["time"] + 2.0, 2))

        if args.precision == "word":
            original_lines = insert_instrumental_parts(original_lines)

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
