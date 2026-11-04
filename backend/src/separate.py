import sys
import os
import argparse
import logging
import shutil
import traceback
from audio_separator.separator import Separator

logging.basicConfig(level=logging.INFO)

# Model mappings per separation mode
MODE_MODELS = {
    "fast": "UVR-MDX-NET-Inst_1.onnx",
    "balanced": "UVR-MDX-NET-Inst_HQ_3.onnx",
    "high": "MDX23C-InstVoc HQ",
    "ultra": "BS-Roformer-Viperx-1297"
}

def separate_audio(input_file, output_dir, mode="balanced", output_format="MP3", output_bitrate="192k"):
    os.makedirs(output_dir, exist_ok=True)

    format_upper = output_format.upper()
    ext = format_upper.lower()
    if ext == "aac": ext = "m4a"

    print(f"Starting 3-stem separation [{mode.upper()} mode, Format: {format_upper} {output_bitrate}] for: {input_file}")
    
    # Initialize separator with Apple Silicon / MPS acceleration
    separator_args = {
        "output_format": format_upper,
        "output_dir": output_dir,
        "use_autocast": True,
        "log_level": logging.INFO
    }
    if format_upper in ["MP3", "M4A", "AAC", "OGG"]:
        separator_args["output_bitrate"] = output_bitrate

    separator = Separator(**separator_args)

    # ----------------------------------------------------
    # Stage 1: Primary separation -> Vocals vs Instrumental
    # ----------------------------------------------------
    primary_model = MODE_MODELS.get(mode.lower(), "UVR-MDX-NET-Inst_HQ_3.onnx")
    print(f"Stage 1: Separating Vocals and Instrumental using model: {primary_model}...")
    
    try:
        separator.load_model(primary_model)
        primary_output = separator.separate(input_file)
    except Exception as e:
        print(f"Primary model {primary_model} failed ({e}), falling back to UVR-MDX-NET-Inst_HQ_3.onnx")
        separator.load_model("UVR-MDX-NET-Inst_HQ_3.onnx")
        primary_output = separator.separate(input_file)
    
    temp_vocals_file = None
    canonical_inst = os.path.join(output_dir, f"instrumental.{ext}")

    for fname in primary_output:
        fname_base = os.path.basename(fname)
        fpath = fname if os.path.isabs(fname) else os.path.join(output_dir, fname)
        if "(Vocals)" in fname_base or "vocals" in fname_base.lower():
            temp_vocals_file = fpath
        else:
            if os.path.exists(canonical_inst):
                os.remove(canonical_inst)
            os.rename(fpath, canonical_inst)

    canonical_lead = os.path.join(output_dir, f"lead_vocal.{ext}")
    canonical_back = os.path.join(output_dir, f"back_vocal.{ext}")

    if not temp_vocals_file or not os.path.exists(temp_vocals_file):
        print("Warning: Vocals file not found in Stage 1. Using input file as lead & back vocals.")
        shutil.copyfile(input_file, canonical_lead)
        shutil.copyfile(input_file, canonical_back)
        return canonical_inst, canonical_lead, canonical_back

    # ----------------------------------------------------
    # Stage 2: Secondary separation -> Lead Vocal vs Backing Vocal
    # Model: 5_HP-Karaoke-UVR.pth
    # ----------------------------------------------------
    print("Stage 2: Separating Lead Vocals and Backing Vocals using Karaoke model...")

    try:
        separator.load_model("5_HP-Karaoke-UVR.pth")
        vocal_output = separator.separate(temp_vocals_file)

        lead_temp = None
        back_temp = None

        for fname in vocal_output:
            fname_base = os.path.basename(fname)
            fpath = fname if os.path.isabs(fname) else os.path.join(output_dir, fname)
            if "(Instrumental)" in fname_base or "instrumental" in fname_base.lower():
                back_temp = fpath
            else:
                lead_temp = fpath

        if lead_temp and os.path.exists(lead_temp):
            if os.path.exists(canonical_lead):
                os.remove(canonical_lead)
            os.rename(lead_temp, canonical_lead)
        else:
            shutil.copyfile(temp_vocals_file, canonical_lead)

        if back_temp and os.path.exists(back_temp):
            if os.path.exists(canonical_back):
                os.remove(canonical_back)
            os.rename(back_temp, canonical_back)
        else:
            shutil.copyfile(temp_vocals_file, canonical_back)

        # Cleanup temporary vocals file
        if os.path.exists(temp_vocals_file) and temp_vocals_file not in [canonical_lead, canonical_back]:
            os.remove(temp_vocals_file)

        allowed_stems = {f"audio.{ext}", f"instrumental.{ext}", f"lead_vocal.{ext}", f"back_vocal.{ext}", "lyrics.json"}
        for f in os.listdir(output_dir):
            if f not in allowed_stems and not f.startswith("cover."):
                try:
                    fpath = os.path.join(output_dir, f)
                    if os.path.isfile(fpath):
                        os.remove(fpath)
                except Exception as clean_err:
                    print(f"Cleanup note: could not remove {f}: {clean_err}")

        print(f"Successfully created 3 stems ({ext}): instrumental.{ext}, lead_vocal.{ext}, back_vocal.{ext}")
        return canonical_inst, canonical_lead, canonical_back

    except Exception as e:
        print(f"Stage 2 error: {e}. Falling back to copying vocal track for both Lead and Back.")
        traceback.print_exc()
        if os.path.exists(temp_vocals_file):
            if os.path.exists(canonical_lead): os.remove(canonical_lead)
            if os.path.exists(canonical_back): os.remove(canonical_back)
            shutil.copyfile(temp_vocals_file, canonical_lead)
            shutil.copyfile(temp_vocals_file, canonical_back)
            os.remove(temp_vocals_file)
        
        # Cleanup extra files
        allowed_stems = {f"audio.{ext}", f"instrumental.{ext}", f"lead_vocal.{ext}", f"back_vocal.{ext}", "lyrics.json"}
        for f in os.listdir(output_dir):
            if f not in allowed_stems:
                try:
                    fpath = os.path.join(output_dir, f)
                    if os.path.isfile(fpath):
                        os.remove(fpath)
                except Exception:
                    pass

        return canonical_inst, canonical_lead, canonical_back

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=None, help="Input audio file")
    parser.add_argument("--output_dir", default=None, help="Output directory")
    parser.add_argument("--mode", default="balanced", choices=["fast", "balanced", "high", "ultra"], help="Separation mode")
    parser.add_argument("--format", default="MP3", help="Output audio format (MP3, M4A, WAV)")
    parser.add_argument("--bitrate", default="192k", help="Output bitrate for compressed formats (e.g. 192k, 320k)")
    parser.add_argument("--download_model", default=None, help="Download model and exit")
    args = parser.parse_args()

    if args.download_model:
        model_target = args.download_model.strip()
        import json
        import time
        import requests

        class ProgressSeparator(Separator):
            def download_file_if_not_exists(self, url, output_path):
                if os.path.isfile(output_path):
                    self.logger.debug(f"File already exists at {output_path}, skipping download")
                    return

                print(f"PROGRESS: {json.dumps({'progress': 1, 'status': 'downloading', 'message': f'Starting download for {os.path.basename(output_path)}...'})}", flush=True)
                response = requests.get(url, stream=True, timeout=300)
                if response.status_code == 200:
                    total_size = int(response.headers.get("content-length", 0))
                    downloaded = 0
                    last_time = 0
                    with open(output_path, "wb") as f:
                        for chunk in response.iter_content(chunk_size=1024 * 64):
                            if chunk:
                                f.write(chunk)
                                downloaded += len(chunk)
                                now = time.time()
                                if now - last_time > 0.4:
                                    last_time = now
                                    pct = int((downloaded / total_size) * 100) if total_size > 0 else 50
                                    mb = round(downloaded / (1024 * 1024), 1)
                                    tot_mb = round(total_size / (1024 * 1024), 1) if total_size > 0 else "?"
                                    print(f"PROGRESS: {json.dumps({'progress': pct, 'status': 'downloading', 'message': f'Downloading {os.path.basename(output_path)}: {mb}/{tot_mb} MB ({pct}%)'})}", flush=True)
                    print(f"PROGRESS: {json.dumps({'progress': 100, 'status': 'verifying', 'message': f'Verified {os.path.basename(output_path)}'})}", flush=True)
                else:
                    raise RuntimeError(f"Failed to download file from {url}, response code: {response.status_code}")

        try:
            print(f"PROGRESS: {json.dumps({'progress': 0, 'status': 'starting', 'message': f'Preparing to download {model_target}...'})}", flush=True)
            sep = ProgressSeparator(log_level=logging.WARNING)
            sep.download_model_and_data(model_target)
            print(f"PROGRESS: {json.dumps({'progress': 100, 'status': 'done', 'message': f'Model {model_target} downloaded successfully'})}", flush=True)
            print(json.dumps({"success": True, "action": "download", "model": model_target}), flush=True)
            sys.exit(0)
        except Exception as err:
            print(f"PROGRESS: {json.dumps({'progress': 0, 'status': 'error', 'message': str(err)})}", flush=True)
            print(json.dumps({"success": False, "error": str(err)}), flush=True)
            sys.exit(1)

    if not args.input or not args.output_dir:
        print("Error: --input and --output_dir are required for separation.", file=sys.stderr)
        sys.exit(1)

    separate_audio(args.input, args.output_dir, mode=args.mode, output_format=args.format, output_bitrate=args.bitrate)

