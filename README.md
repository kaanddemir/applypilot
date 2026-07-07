# ApplyPilot

<div align="center">
  <img src="frontend/assets/logo.png" alt="ApplyPilot Logo" width="120" />
</div>

<div align="center">

**A local-first job application tracker with AI-assisted CV review, cover-letter drafting, and focused job-search chat.**

</div>

---

> **Status:** **Prototype Phase**. This project is currently in active development. Some features may be experimental or in progress.

## Overview

ApplyPilot is a single-user web app for managing job applications and getting AI help grounded in your own CV/profile. It brings the core job-search workflow into one focused workspace: tracking applications, reviewing fit against job descriptions, drafting cover letters, and asking job-search questions with optional application context.

The app is designed for local use. Your profile, applications, chats, provider keys, and preferences stay in your browser storage, while the backend only serves the frontend and utility endpoints.

## Core Features

### Application Management
- **Kanban Board**: Track applications across statuses with drag-and-drop support.
- **Search & Filters**: Quickly find applications by company, role, source, or status.
- **Application Details**: Store notes, job URLs, descriptions, and timeline data.
- **Spreadsheet Import/Export**: Move application data through `.xlsx` files.

### AI Assistance
- **CV Match Analysis**: Compare your profile with a job posting.
- **Cover Letter Drafting**: Generate drafts from your profile and application details.
- **Job-Search Chat**: Ask contextual questions with optional application context attached.
- **Shared Prompt Config**: All AI engines use the same ApplyPilot prompt configuration from `GET /api/prompt-config`.

### Privacy & UX
- **Local-First Storage**: Data is saved in browser `localStorage`.
- **No Server-Side API Keys**: Cloud provider keys are entered in the app and used directly from the browser.
- **Local Model Option**: Run supported browser models with WebLLM on WebGPU-capable browsers.
- **Responsive App Shell**: A lightweight frontend served directly by FastAPI.

## Current Limitations
- **Single-User Focus**: The app is intended for local personal use, not shared public deployment.
- **Browser Storage**: Clearing browser storage clears application data.
- **Job URL Fetching**: Some job sites require JavaScript or login; paste the job description manually when fetching fails.
- **Local AI Performance**: Local model speed and quality depend on browser, hardware, and selected model.

## Tech Stack
- **Backend**: [FastAPI](https://fastapi.tiangolo.com/)
- **Frontend**: Vanilla JavaScript (ES6 modules)
- **Styling**: Plain CSS
- **AI Providers**: Browser-side cloud provider calls and optional [WebLLM](https://github.com/mlc-ai/web-llm)
- **Storage**: Browser LocalStorage API

## Getting Started

### Setup

Requires Python 3.10+.

1. **Create and activate a virtual environment**
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```

2. **Install dependencies**
   ```bash
   pip install -r backend/requirements.txt
   ```

3. **Start the server**
   ```bash
   cd backend
   uvicorn app:app --reload
   ```

4. **Open the app**
   ```text
   http://localhost:8000
   ```

## Project Structure

```text
ApplyPilot/
├── backend/
│   ├── app.py                # FastAPI app, static serving, and API endpoints
│   ├── fetcher.py            # Job-posting URL fetch and content extraction
│   ├── prompts.py            # Shared AI persona and task prompts
│   └── requirements.txt      # Python dependencies
├── frontend/
│   ├── assets/
│   │   └── logo.png          # App and README logo asset
│   ├── css/                  # Theme, layout, board, profile, and component styles
│   ├── js/                   # App state, rendering, AI, chat, board, and wizards
│   └── index.html            # HTML entry point
└── README.md
```

## Data Storage

ApplyPilot is local-first:
- **Local Storage**: Applications, profile text, uploaded profile previews, chats, selected engine, model preferences, and cloud provider keys are stored in browser `localStorage`.
- **No Backend Database**: The backend does not store user data.
- **Manual Control**: Use import/export when you want to move application data through a spreadsheet.

## Basic Workflow
1. Open **Profile / CV** and add your CV by uploading a file or pasting text.
2. Pick an AI engine in the profile settings.
3. Click **Add application** and fill in the company, role, source, notes, and job description.
4. Open an application to run CV match analysis, draft a cover letter, or attach it to chat.
5. Use import/export when you want to back up or move your application data.

## License
This project is open source and available under the **MIT License**.

## Footer
<div align="center">
  <p>Built by <a href="https://heykaan.dev">heykaan.dev</a></p>
</div>
