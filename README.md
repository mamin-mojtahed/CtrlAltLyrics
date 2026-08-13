# Ctrl+Alt+Lyrics

![ctrl-alt-lyrics logo wide](./frontend/public/ctrlaltlyrics-logo-wide.webp)

A local all-in-one full-stack Karaoke Player and Lyrics Studio designed for downloading, splitting audio stems, synchronizing lyrics, and playing high-quality karaoke tracks in real time.
> Vibe-coded with Google Antigravity IDE & Gemini

---

## 🚀 Features

- **Audio Stem Separation**: Automatically downloads songs and splits them into distinct audio stems (**Instrumental**, **Lead Vocals**, and **Backing Vocals**) using AI audio separation.
- **Synchronized Lyrics**: Automatically fetches timestamped lyrics (LRC) with fallback multi-provider support.
- **Pronunciation & Romanization**: Auto-generates Romanized pronunciations for non-English song lyrics.
- **Live Queue & Library Management**: Add songs via search queries, track real-time processing status, and sort/filter your local library.
- **Dual Display Modes**: Dedicated Dashboard controls and Display view with customizable fonts, colors, and line-by-line lyric highlighting.

---

## 🛠️ Architecture

- **Backend**: Node.js & Express server (`server.js`, `backend/src/api.js`) with Socket.IO for real-time progress updates.
- **Frontend**: Vite web app (`frontend/`) built with Vanilla JS, HTML5, CSS Glassmorphism design system.
- **Audio Processing**: Python environment (`venv/`) integrating `spotdl` for track fetching, Demucs audio separation (`separate.py`), and `fetch_lyrics.py`.

---

## 📦 Prerequisites

Before running the application, make sure you have installed:

- **Node.js**: v18.x or later
- **Python**: v3.10+ (v3.12 recommended)
- **FFmpeg**: Required for audio stem splitting and processing.

### Python Package Requirements:
- `spotdl`: Downloads audio tracks
- `audio-separator`: AI audio stem separation engine
- `requests`: HTTP requests for lyrics provider APIs
- `pykakasi`: Japanese Kana/Kanji transliteration to Hepburn Romanized text
- `unidecode`: Transliteration for Persian, Korean, Cyrillic, Greek, and non-ASCII scripts

---

## ⚙️ Setup & Installation

### 1. Clone & Install Node Dependencies

```bash
# Install root Node dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### 2. Python Virtual Environment Setup

```bash
# Create Python virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install required Python packages from requirements.txt
pip install -r requirements.txt
```

---

## 🏃 Running the Application

Start both the backend server and frontend development environment:

### Terminal 1: Backend Server
```bash
npm start
# Server starts on http://localhost:3000
```

### Terminal 2: Frontend Client
```bash
npm run dev
# Vite dev server runs (default: http://localhost:5173)
```

Open `http://localhost:5173` (or the URL output by Vite) in your browser to access **CtrlAltLyrics**.

---

## 📁 Project Structure

```
CtrlAltLyrics/
├── backend/
│   ├── data/           # Song cache history & lightweight metadata
│   ├── downloads/      # Downloaded audio tracks & generated stems
│   └── src/            # Backend API routes, separation scripts, & lyrics fetchers
├── frontend/           # Vite application (Dashboard UI, Display view, Styles)
├── venv/               # Python virtual environment for stem separation
├── server.js           # Main Express & Socket.IO server entrypoint
├── package.json        # Project root dependencies and run scripts
├── requirements.txt    # Python dependencies list
└── README.md           # Project documentation
```

---

## Demo

![tabs side-by-side demo](/media/demo-screenshot-tabs-sidebyside.webp)

![edit pop-up demo](/media/demo-screenshot-edit-popup.webp)

---

## 📄 License

ISC License
