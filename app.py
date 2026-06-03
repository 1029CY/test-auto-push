import os
import sys
import uuid
import shutil
import subprocess
import logging

import torch
import soundfile as sf
import torchaudio

_orig_ta_load = torchaudio.load
def _patched_load(filepath, **kwargs):
    try:
        return _orig_ta_load(filepath, **kwargs)
    except Exception:
        data, sr = sf.read(str(filepath), dtype="float32")
        if data.ndim == 1:
            data = data[:, None]
        return torch.from_numpy(data).T, sr
torchaudio.load = _patched_load

_orig_ta_save = torchaudio.save
def _patched_save(filepath, tensor, sample_rate, **kwargs):
    try:
        return _orig_ta_save(filepath, tensor, sample_rate, **kwargs)
    except Exception:
        data = tensor.T.numpy()
        sf.write(str(filepath), data, sample_rate)
torchaudio.save = _patched_save

from demucs.pretrained import get_model
from demucs.audio import AudioFile
from demucs.apply import apply_model

from flask import Flask, request, jsonify, send_from_directory

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

FFMPEG = shutil.which("ffmpeg") or r"C:\Users\admin\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe"
FFPROBE = shutil.which("ffprobe") or os.path.join(os.path.dirname(FFMPEG), "ffprobe.exe")
FFMPEG_DIR = os.path.dirname(FFMPEG)
if FFMPEG_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = FFMPEG_DIR + ";" + os.environ.get("PATH", "")

app = Flask(__name__, static_folder="static")

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

AUDIO_EXT = {"mp3", "wav", "m4a", "aac", "flac", "ogg", "wma", "opus"}
VIDEO_EXT = {"mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "ts", "mts"}
ALLOWED_EXT = AUDIO_EXT | VIDEO_EXT
MAX_FILE_MB = 500

log.info("Loading Demucs model (htdemucs)...")
MODEL = get_model("htdemucs")
MODEL.eval()
log.info("Demucs model loaded.")


def allowed(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT


def is_video(ext: str) -> bool:
    return ext in VIDEO_EXT


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory("static", filename)


@app.route("/api/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify(error="No file provided"), 400

    f = request.files["file"]
    if not f.filename or not allowed(f.filename):
        return jsonify(error="Unsupported format"), 400

    ext = f.filename.rsplit(".", 1)[1].lower()
    uid = uuid.uuid4().hex[:12]
    input_path = os.path.join(UPLOAD_DIR, f"{uid}.{ext}")
    f.save(input_path)

    log.info(f"Received file: {f.filename} ({ext}) -> {uid}")

    file_mb = os.path.getsize(input_path) / (1024 * 1024)
    if file_mb > MAX_FILE_MB:
        os.remove(input_path)
        return jsonify(error=f"File too large ({file_mb:.0f}MB > {MAX_FILE_MB}MB)"), 400

    video_path = None
    if is_video(ext):
        video_path = os.path.join(OUTPUT_DIR, f"{uid}_original.{ext}")
        shutil.copy2(input_path, video_path)
        log.info(f"Video saved for later merge: {video_path}")

    # Convert to wav for demucs
    wav_path = os.path.join(UPLOAD_DIR, f"{uid}.wav")
    if ext == "wav":
        wav_path = input_path
    else:
        log.info(f"Extracting audio to wav via ffmpeg...")
        try:
            result = subprocess.run(
                [FFMPEG, "-y", "-i", input_path, "-vn", "-ar", "44100", "-ac", "2", wav_path],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                log.error(f"ffmpeg failed: {result.stderr}")
                os.remove(input_path)
                if video_path:
                    os.remove(video_path)
                return jsonify(error=f"ffmpeg conversion failed: {result.stderr[:500]}"), 500
            if input_path != wav_path:
                os.remove(input_path)
            log.info("Audio extraction done.")
        except FileNotFoundError:
            log.error(f"ffmpeg not found at: {FFMPEG}")
            os.remove(input_path)
            if video_path:
                os.remove(video_path)
            return jsonify(error=f"ffmpeg not found at: {FFMPEG}"), 500

    vocals_path = os.path.join(OUTPUT_DIR, f"{uid}_vocals.wav")
    accomp_path = os.path.join(OUTPUT_DIR, f"{uid}_accompaniment.wav")

    log.info("Starting Demucs separation...")
    try:
        wav = AudioFile(wav_path).read(streams=0, samplerate=MODEL.samplerate, channels=MODEL.audio_channels)
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / ref.std()

        with torch.no_grad():
            sources = apply_model(MODEL, wav[None], device="cpu")[0]

        sources = sources * ref.std() + ref.mean()

        stems = MODEL.sources
        vocals_idx = stems.index("vocals")
        vocals = sources[vocals_idx]
        accompaniment = sources.sum(0) - vocals

        torchaudio.save(vocals_path, vocals.cpu(), MODEL.samplerate)
        torchaudio.save(accomp_path, accompaniment.cpu(), MODEL.samplerate)

        log.info(f"Vocals saved: {vocals_path}")
        log.info(f"Accompaniment saved: {accomp_path}")

    except Exception as e:
        log.exception("Error during separation")
        for p in [wav_path, video_path]:
            if p and os.path.exists(p):
                os.remove(p)
        return jsonify(error=f"Separation error: {e}"), 500
    finally:
        if wav_path != input_path and os.path.exists(wav_path):
            os.remove(wav_path)

    if not os.path.exists(vocals_path) or not os.path.exists(accomp_path):
        log.error("Separation produced no output files")
        return jsonify(error="Separation produced no output"), 500

    log.info(f"Separation complete for {uid}")
    resp = dict(
        vocals=f"/api/audio/{uid}_vocals.wav",
        accompaniment=f"/api/audio/{uid}_accompaniment.wav",
    )
    if video_path:
        resp["video"] = f"/api/audio/{uid}_original.{ext}"
        resp["video_uid"] = uid
        resp["video_ext"] = ext
    return jsonify(**resp)


@app.route("/api/audio/<filename>")
def serve_audio(filename):
    return send_from_directory(OUTPUT_DIR, filename)


@app.route("/api/export", methods=["POST"])
def export():
    if "file" not in request.files:
        return jsonify(error="No file provided"), 400

    f = request.files["file"]
    uid = uuid.uuid4().hex[:12]
    output_path = os.path.join(OUTPUT_DIR, f"{uid}_mix.wav")
    f.save(output_path)
    log.info(f"Exported mix: {output_path}")

    return jsonify(download_url=f"/api/audio/{uid}_mix.wav")


@app.route("/api/export-video", methods=["POST"])
def export_video():
    data = request.form
    video_uid = data.get("video_uid")
    video_ext = data.get("video_ext", "mp4")

    if "file" not in request.files:
        return jsonify(error="No audio file provided"), 400

    if not video_uid:
        return jsonify(error="video_uid required"), 400

    original_video = os.path.join(OUTPUT_DIR, f"{video_uid}_original.{video_ext}")
    if not os.path.exists(original_video):
        return jsonify(error="Original video not found"), 404

    uid = uuid.uuid4().hex[:12]
    mix_audio = os.path.join(OUTPUT_DIR, f"{uid}_mix.wav")
    request.files["file"].save(mix_audio)

    output_video = os.path.join(OUTPUT_DIR, f"{uid}_mix.{video_ext}")

    log.info(f"Merging audio into video: {original_video} + {mix_audio}")
    try:
        result = subprocess.run(
            [
                FFMPEG, "-y",
                "-i", original_video,
                "-i", mix_audio,
                "-c:v", "copy",
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-shortest",
                output_video,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            log.error(f"ffmpeg merge failed: {result.stderr}")
            return jsonify(error=f"Video merge failed: {result.stderr[:500]}"), 500
    finally:
        if os.path.exists(mix_audio):
            os.remove(mix_audio)

    log.info(f"Video export done: {output_video}")
    return jsonify(download_url=f"/api/audio/{uid}_mix.{video_ext}")


if __name__ == "__main__":
    log.info(f"ffmpeg path: {FFMPEG}")
    log.info(f"ffmpeg exists: {os.path.exists(FFMPEG)}")
    app.run(host="0.0.0.0", port=5000, debug=True)
