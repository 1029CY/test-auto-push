let audioContext = null;
let vocalsBuffer = null;
let accompBuffer = null;
let vocalsSource = null;
let accompSource = null;
let vocalsGain = null;
let accompGain = null;
let isPlayingVocals = false;
let isPlayingAccomp = false;
let isPlayingMix = false;
let videoUid = null;
let videoExt = null;

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const progressSection = document.getElementById("progressSection");
const progressFill = document.getElementById("progressFill");
const statusText = document.getElementById("statusText");
const playerSection = document.getElementById("playerSection");
const exportResult = document.getElementById("exportResult");
const exportLink = document.getElementById("exportLink");
const videoPreview = document.getElementById("videoPreview");
const videoPlayer = document.getElementById("videoPlayer");
const exportVideoBtn = document.getElementById("exportVideoBtn");

dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
});

dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) uploadFile(fileInput.files[0]);
});

async function uploadFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    const audioExts = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "wma", "opus"];
    const videoExts = ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv"];
    if (!audioExts.includes(ext) && !videoExts.includes(ext)) {
        alert("不支持的格式");
        return;
    }

    dropZone.classList.add("hidden");
    progressSection.classList.remove("hidden");
    playerSection.classList.add("hidden");
    exportResult.classList.add("hidden");
    statusText.textContent = "正在上传...";
    progressFill.style.width = "10%";

    const formData = new FormData();
    formData.append("file", file);

    try {
        statusText.textContent = "正在分离人声与伴奏，请稍候...";
        progressFill.style.width = "30%";

        const resp = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || "Upload failed");
        }

        progressFill.style.width = "80%";
        statusText.textContent = "加载音频中...";

        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const [vocalsResp, accompResp] = await Promise.all([
            fetch(data.vocals),
            fetch(data.accompaniment),
        ]);
        const [vocalsArrayBuffer, accompArrayBuffer] = await Promise.all([
            vocalsResp.arrayBuffer(),
            accompResp.arrayBuffer(),
        ]);
        [vocalsBuffer, accompBuffer] = await Promise.all([
            audioContext.decodeAudioData(vocalsArrayBuffer),
            audioContext.decodeAudioData(accompArrayBuffer),
        ]);

        progressFill.style.width = "100%";
        statusText.textContent = "分离完成！";

        videoUid = data.video_uid || null;
        videoExt = data.video_ext || null;

        setTimeout(() => {
            progressSection.classList.add("hidden");
            playerSection.classList.remove("hidden");
            resetTrackStates();

            if (data.video) {
                videoPreview.classList.remove("hidden");
                videoPlayer.src = data.video;
                exportVideoBtn.classList.remove("hidden");
            } else {
                videoPreview.classList.add("hidden");
                videoPlayer.src = "";
                exportVideoBtn.classList.add("hidden");
            }
        }, 500);

    } catch (err) {
        statusText.textContent = `错误: ${err.message}`;
        progressFill.style.width = "0%";
        setTimeout(() => {
            progressSection.classList.add("hidden");
            dropZone.classList.remove("hidden");
        }, 3000);
    }
}

function resetTrackStates() {
    isPlayingVocals = false;
    isPlayingAccomp = false;
    isPlayingMix = false;
    document.getElementById("vocalsPlayBtn").textContent = "播放";
    document.getElementById("accompPlayBtn").textContent = "播放";
    document.getElementById("mixPlayBtn").textContent = "混音预览";
    document.getElementById("vocalsVolume").value = 100;
    document.getElementById("accompVolume").value = 100;
    document.getElementById("vocalsVolumeLabel").textContent = "100%";
    document.getElementById("accompVolumeLabel").textContent = "100%";
    exportResult.classList.add("hidden");
}

function createSource(buffer) {
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    return source;
}

function toggleTrack(track) {
    if (track === "vocals") {
        if (isPlayingVocals) stopVocals();
        else playVocals();
    } else {
        if (isPlayingAccomp) stopAccomp();
        else playAccomp();
    }
}

function playVocals() {
    if (!vocalsBuffer) return;
    stopVocals();
    vocalsSource = createSource(vocalsBuffer);
    vocalsGain = audioContext.createGain();
    vocalsGain.gain.value = document.getElementById("vocalsVolume").value / 100;
    vocalsSource.connect(vocalsGain);
    vocalsGain.connect(audioContext.destination);
    vocalsSource.start();
    vocalsSource.onended = () => {
        isPlayingVocals = false;
        document.getElementById("vocalsPlayBtn").textContent = "播放";
    };
    isPlayingVocals = true;
    document.getElementById("vocalsPlayBtn").textContent = "暂停";
}

function stopVocals() {
    if (vocalsSource) {
        try { vocalsSource.stop(); } catch (_) {}
        vocalsSource.disconnect();
        vocalsSource = null;
    }
    isPlayingVocals = false;
    document.getElementById("vocalsPlayBtn").textContent = "播放";
}

function playAccomp() {
    if (!accompBuffer) return;
    stopAccomp();
    accompSource = createSource(accompBuffer);
    accompGain = audioContext.createGain();
    accompGain.gain.value = document.getElementById("accompVolume").value / 100;
    accompSource.connect(accompGain);
    accompGain.connect(audioContext.destination);
    accompSource.start();
    accompSource.onended = () => {
        isPlayingAccomp = false;
        document.getElementById("accompPlayBtn").textContent = "播放";
    };
    isPlayingAccomp = true;
    document.getElementById("accompPlayBtn").textContent = "暂停";
}

function stopAccomp() {
    if (accompSource) {
        try { accompSource.stop(); } catch (_) {}
        accompSource.disconnect();
        accompSource = null;
    }
    isPlayingAccomp = false;
    document.getElementById("accompPlayBtn").textContent = "播放";
}

function updateVolume(track) {
    const slider = document.getElementById(track === "vocals" ? "vocalsVolume" : "accompVolume");
    const label = document.getElementById(track === "vocals" ? "vocalsVolumeLabel" : "accompVolumeLabel");
    const value = slider.value;
    label.textContent = value + "%";

    const gain = track === "vocals" ? vocalsGain : accompGain;
    if (gain) {
        gain.gain.value = value / 100;
    }
}

function toggleMix() {
    if (isPlayingMix) stopAll();
    else playMix();
}

function playMix() {
    if (!vocalsBuffer || !accompBuffer) return;
    stopAll();

    vocalsSource = createSource(vocalsBuffer);
    accompSource = createSource(accompBuffer);

    vocalsGain = audioContext.createGain();
    accompGain = audioContext.createGain();
    vocalsGain.gain.value = document.getElementById("vocalsVolume").value / 100;
    accompGain.gain.value = document.getElementById("accompVolume").value / 100;

    vocalsSource.connect(vocalsGain);
    accompSource.connect(accompGain);
    vocalsGain.connect(audioContext.destination);
    accompGain.connect(audioContext.destination);

    vocalsSource.start();
    accompSource.start();

    vocalsSource.onended = () => {
        isPlayingMix = false;
        isPlayingVocals = false;
        isPlayingAccomp = false;
        document.getElementById("mixPlayBtn").textContent = "混音预览";
    };

    isPlayingMix = true;
    isPlayingVocals = true;
    isPlayingAccomp = true;
    document.getElementById("mixPlayBtn").textContent = "停止混音";
}

function stopAll() {
    stopVocals();
    stopAccomp();
    isPlayingMix = false;
    document.getElementById("mixPlayBtn").textContent = "混音预览";
}

function renderMixBlob() {
    const offlineCtx = new OfflineAudioContext(
        vocalsBuffer.numberOfChannels,
        vocalsBuffer.length,
        vocalsBuffer.sampleRate
    );

    const vSource = offlineCtx.createBufferSource();
    vSource.buffer = vocalsBuffer;
    const vGain = offlineCtx.createGain();
    vGain.gain.value = document.getElementById("vocalsVolume").value / 100;
    vSource.connect(vGain);
    vGain.connect(offlineCtx.destination);
    vSource.start();

    const aSource = offlineCtx.createBufferSource();
    aSource.buffer = accompBuffer;
    const aGain = offlineCtx.createGain();
    aGain.gain.value = document.getElementById("accompVolume").value / 100;
    aSource.connect(aGain);
    aGain.connect(offlineCtx.destination);
    aSource.start();

    return offlineCtx.startRendering().then((rendered) => audioBufferToWav(rendered));
}

async function exportMix() {
    if (!vocalsBuffer || !accompBuffer) return;

    const exportBtn = document.getElementById("exportBtn");
    exportBtn.textContent = "导出中...";
    exportBtn.disabled = true;

    try {
        const wavBlob = await renderMixBlob();
        const formData = new FormData();
        formData.append("file", wavBlob, "mix.wav");

        const resp = await fetch("/api/export", { method: "POST", body: formData });
        const data = await resp.json();

        if (!resp.ok) throw new Error(data.error || "Export failed");

        exportLink.href = data.download_url;
        exportLink.textContent = "下载混音音频";
        exportResult.classList.remove("hidden");

    } catch (err) {
        alert("导出失败: " + err.message);
    } finally {
        exportBtn.textContent = "导出音频";
        exportBtn.disabled = false;
    }
}

async function exportVideo() {
    if (!vocalsBuffer || !accompBuffer || !videoUid) return;

    const btn = document.getElementById("exportVideoBtn");
    btn.textContent = "导出中...";
    btn.disabled = true;

    try {
        const wavBlob = await renderMixBlob();
        const formData = new FormData();
        formData.append("file", wavBlob, "mix.wav");
        formData.append("video_uid", videoUid);
        formData.append("video_ext", videoExt);

        const resp = await fetch("/api/export-video", { method: "POST", body: formData });
        const data = await resp.json();

        if (!resp.ok) throw new Error(data.error || "Export failed");

        exportLink.href = data.download_url;
        exportLink.textContent = "下载混音视频";
        exportResult.classList.remove("hidden");

    } catch (err) {
        alert("导出失败: " + err.message);
    } finally {
        btn.textContent = "导出视频";
        btn.disabled = false;
    }
}

function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitsPerSample = 16;

    let interleaved;
    if (numChannels === 2) {
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);
        interleaved = new Float32Array(left.length * 2);
        for (let i = 0; i < left.length; i++) {
            interleaved[i * 2] = left[i];
            interleaved[i * 2 + 1] = right[i];
        }
    } else {
        interleaved = buffer.getChannelData(0);
    }

    const dataLength = interleaved.length * (bitsPerSample / 8);
    const headerLength = 44;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, totalLength - 8, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, "data");
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < interleaved.length; i++) {
        const sample = Math.max(-1, Math.min(1, interleaved[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
}

function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}
