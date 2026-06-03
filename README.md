# 音乐人声/伴奏分离工具

上传音乐或视频文件，AI 自动分离人声与伴奏，自由调节音量并导出。

## 功能

- 支持音频格式：MP3, WAV, M4A, AAC, FLAC, OGG, WMA, OPUS
- 支持视频格式：MP4, MKV, AVI, MOV, WEBM, FLV, WMV
- AI 分离人声与伴奏（基于 Meta Demucs）
- 独立调节人声/伴奏音量（0% ~ 200%）
- 实时混音预览
- 导出混音音频
- 视频文件支持导出混音后的视频

## 安装

### 环境要求

- Python 3.10+
- FFmpeg

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/1029CY/music-separator.git
cd music-separator

# 安装 Python 依赖
pip install -r requirements.txt
```

FFmpeg 安装：

- Windows：`winget install Gyan.FFmpeg`
- macOS：`brew install ffmpeg`
- Linux：`apt install ffmpeg` 或 `yum install ffmpeg`

## 启动

```bash
python app.py
```

浏览器访问 http://localhost:5000

## 使用方法

1. 拖拽或点击上传音乐/视频文件
2. 等待 AI 分离（首次需要下载模型，约 1GB）
3. 拖动滑块调节人声和伴奏音量
4. 点击「混音预览」试听效果
5. 点击「导出音频」或「导出视频」下载

## 技术栈

- 后端：Python Flask
- 分离引擎：Demucs (htdemucs)
- 前端：原生 HTML/CSS/JavaScript + Web Audio API
- 音频处理：torchaudio + soundfile
- 视频处理：FFmpeg

## 截图

上传页面：

```
┌─────────────────────────────────────────┐
│           音乐人声/伴奏分离              │
│  ┌───────────────────────────────────┐  │
│  │      拖拽上传区域 / 点击选择文件    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

调节页面：

```
┌─ 人声 ────────────────────────────────┐
│  ▶ 播放  ━━━━●━━━━━ 音量: 100%        │
└───────────────────────────────────────┘
┌─ 伴奏 ────────────────────────────────┐
│  ▶ 播放  ━━━━●━━━━━ 音量: 100%        │
└───────────────────────────────────────┘
  [混音预览]  [停止]  [导出音频]  [导出视频]
```

## 许可证

MIT
