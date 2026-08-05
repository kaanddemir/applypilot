# ApplyPilot

<div align="center">
  <img src="frontend/assets/logo.png" alt="ApplyPilot Logo" width="120" />
</div>

<div align="center">

**A job application tracker with AI-assisted CV review, cover-letter drafting, and focused job-search chat.**

</div>

---

## Overview

ApplyPilot keeps the job-search workflow in one place: a Kanban board of applications, an honest match analysis of your CV against a specific posting, a cover-letter draft grounded in your real experience, and a chat that can have any one application attached as context. Everything you enter lives in your browser — the applications, the CV, the chats, and the provider keys.

The AI runs in the browser too, which is the part that shapes the rest of the design. Cloud calls go straight from the page to `api.anthropic.com`, `api.openai.com`, or `generativelanguage.googleapis.com` with your own key, and the local option runs a WebLLM model on WebGPU with no network at all. The backend never sees a key and never sees a CV: it parses uploaded files, serves one shared prompt configuration so every engine behaves the same, and serves the frontend.

Built with FastAPI, vanilla browser UI assets, three cloud providers behind one interface, and WebLLM for the local engine.

## Core Features

- **Kanban Board**: Applications tracked across `Saved`, `Applied`, `Interview`, `Offer`, and `Rejected`, with drag-and-drop between columns. `Archived` exists as a status but stays off the board.
- **Readable Application IDs**: Each application gets an `AP-8K2P-9QZ4` identifier from Crockford's alphabet, so ambiguous characters never appear in the spreadsheet a person reads.
- **Match Analysis**: The model compares your profile against a posting and returns a structured verdict — met requirements with the evidence for each, gaps ranked by severity, ATS keywords present and missing, and ready-to-paste CV bullets traceable to real experience. No numeric score, and unmet hard requirements cap the verdict no matter how many nice-to-haves are met.
- **Cover Letter Drafting**: Three to four paragraphs from your profile and the application's details, with bracket placeholders rather than guesses when the company or role is unknown.
- **Chat with Attached Context**: Any application can be attached to a chat turn; a saved analysis is treated as authoritative rather than redone.
- **Per-Turn Prompt Scoping**: One system prompt describes all three modes, but each turn is sent only the section it needs. Without that, small local models echo the analysis JSON schema into the conversation.
- **Four Engines, One Interface**: Claude, ChatGPT, and Gemini with your own key, or a WebLLM model in the browser with no key. Keys are verified against the provider's own models endpoint before you rely on them.
- **Dependency-Free Spreadsheets**: `.xlsx` export and import are written by hand against the file format — no library. Exports carry one column pair per job source, live hyperlinks, and the application ID, so a file that goes out and comes back matches itself.
- **CV Parsing**: `.txt`, `.pdf`, and `.docx` uploaded to the one endpoint that reads files.

## Current Limitations

- **Browser Storage Only**: There is no database and no sync. Clearing site data clears everything, and a second browser starts empty. Use the `.xlsx` export as the backup.
- **Keys Sit in localStorage**: Cloud provider keys are stored in plain text in the browser, which is worth knowing on a shared computer. The Local engine needs no key at all.
- **Single-User, Loopback Only**: The server is meant for `localhost`. CORS is wide open and there is no authentication, so it should not be exposed on a network.
- **First Local Run Is Not Offline**: WebLLM's runtime is imported from `esm.run` and the model weights download on first load. After that, local inference is genuinely local.
- **WebGPU Required for Local**: Chrome or Edge. Speed and answer quality depend on the machine and the chosen model.
- **Manual Job Descriptions**: Postings are pasted in, never scraped. With only a title and company, the analysis still runs but says it is working from limited information.
- **Import Needs `DecompressionStream`**: Browsers without it can read only uncompressed `.xlsx`; the importer says so rather than failing quietly.

## Tech Stack

- **Backend**: [FastAPI](https://fastapi.tiangolo.com/), [Uvicorn](https://www.uvicorn.org/), [pypdf](https://github.com/py-pdf/pypdf), [python-docx](https://github.com/python-openxml/python-docx)
- **Frontend**: Vanilla HTML, CSS, and JavaScript ES modules — no build step and no framework
- **Cloud AI**: [Anthropic](https://docs.anthropic.com/), [OpenAI](https://platform.openai.com/docs), and [Google Gemini](https://ai.google.dev/) APIs, called directly from the browser
- **Local AI**: [WebLLM](https://github.com/mlc-ai/web-llm) on WebGPU
- **Storage**: Browser `localStorage`
- **Testing**: [`node:test`](https://nodejs.org/api/test.html)

## Getting Started

Requires Python 3.10+. An API key is optional: the Local engine needs none, and the board, spreadsheets, and profile work with no AI configured at all.

**1. Install.**

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
```

**2. Add your CV.** Open **Profile / CV** and either upload a `.txt`, `.pdf`, or `.docx`, or paste the text. Everything the AI does is grounded in this.

**3. Pick an engine.** In **Profile → AI engine**, either choose Claude, ChatGPT, or Gemini and paste your key (it is checked against the provider before it is trusted), or choose **Local** and load a WebLLM model — no key, and after the first download, no network.

### Run

```bash
python run.py
```

It checks the setup before starting and prints where to open the app:

```text
  ApplyPilot
  ────────────────────────────────────────────
  Open      http://localhost:8000
  AI        in your browser, keys never reach this server
  Data      browser localStorage
  Stop      Ctrl+C
```

Ctrl+C stops it. Missing setup — a dependency, a port already taken — is reported before anything starts, with the command that fixes it. `.venv` does not have to be activated first: when it exists, `run.py` switches to that interpreter itself and says so.

### Configuration

Three environment variables, all optional: `PORT` (8000); `RELOAD` (`1` restarts the server when `backend/` changes — the frontend is static, so editing CSS or JS never needs it); `LOG_LEVEL` (`DEBUG` restores Uvicorn's startup notes and its per-request access log, which a single page load otherwise fills with static-file lines). Everything else — engine, model, and keys — is set in the UI.

## Project Structure

```text
ApplyPilot/
├── backend/
│   ├── app.py                # FastAPI app, static serving, and the two API endpoints
│   ├── prompts.py            # The one system prompt: persona plus all three modes
│   └── requirements.txt
├── frontend/
│   ├── assets/logo.png
│   ├── css/                  # base (theme, layout), app (board, chat), profile
│   ├── js/                   # ai (four engines), board, chat, excel (xlsx by hand),
│   │                         # profile, wizards, state, store, render, main, icons
│   └── index.html            # The whole UI; views are switched in the DOM
├── tests/                    # Excel round-trip and application normalization
├── run.py                    # Entrypoint: python run.py, Ctrl+C stops it
└── LICENSE
```

## Data Storage

There is no database and the backend stores nothing. Everything lives in `localStorage` under the `applypilot_*` namespace: applications, the profile text and the uploaded file's preview, chat sessions, the selected engine and per-provider model, the cloud provider keys, and UI state such as the board layout, filter, and sort.

Where your data actually goes:

- **To the backend**: only an uploaded CV file, and only to have its text extracted. It is parsed in memory, returned to the browser, and never written to disk.
- **To a cloud provider**: your profile text, the job posting, and the conversation, sent by the browser directly to whichever provider you selected, using your key. Nothing routes through this server.
- **To nowhere**: everything, when the Local engine is selected. Inference runs in the browser.

Stopping the server does not touch any of it — it is in the browser, not in the process. Use **export to `.xlsx`** for a real backup.

## API

- `GET /` — the app (the frontend is mounted at the root, so any other path is a static file)
- `POST /api/parse-profile-file` — `multipart/form-data`, field `file`: a `.txt`, `.pdf`, or `.docx` up to 10 MB. Returns `{ "filename": "...", "text": "..." }`. A scanned PDF with no selectable text is rejected with a message that says so rather than returning an empty string.
- `GET /api/prompt-config` — `{ "system_prompt": "...", "analyze_framing": "..." }`. The `{user_profile}` slot is left unfilled; the browser fills it, which is how the profile stays out of this server.

## Testing

```bash
node --test tests/*.test.mjs
```

The suite uses Node's built-in test runner against the frontend modules directly. There is no `package.json` and nothing to install — the browser code has no dependencies, so neither do its tests.

## Runtime Notes

- Static responses are sent with `Cache-Control: no-cache, must-revalidate`. Without it, `StaticFiles` sends no caching header at all and browsers apply heuristic freshness, which makes an edit to the JS or CSS appear to do nothing until a hard reload.
- The full system prompt covers all three modes, so each turn is sent only its own section plus a mode-specific formatting footer. If the expected section markers are not found, the whole prompt is sent rather than a mangled one.
- `<think>` blocks from reasoning models are stripped before the text reaches the UI.
- Chat history is capped at 16 messages. The system prompt already embeds the whole CV, which on a 1.7B local model leaves little context for anything else.
- A key is validated once per session against the provider's models endpoint, so a typo surfaces in Settings rather than as a failed analysis later.
- Match analysis is asked for as strict JSON with no surrounding prose; the client parses it and renders the fields rather than showing raw model output.

## License

This project is open source and available under the [MIT License](LICENSE).

## Footer

<div align="center">
  <p>Built by <a href="https://heykaan.dev">heykaan.dev</a></p>
</div>
