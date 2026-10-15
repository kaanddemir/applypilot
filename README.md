# ApplyPilot 2.0.0

<div align="center">
  <img src="frontend/assets/logo.png" alt="ApplyPilot Logo" width="120" />

**A job application tracker with evidence-based AI job fit analysis**

</div>

## What is ApplyPilot?

ApplyPilot keeps your job search in one place: applications on a Kanban board or table, the job description and notes for each one, a single saved CV, and an optional Gemini comparison of that CV against a posting.

It is a single-user local application. Data stays in your browser and the Gemini key stays on the local server. There are no user accounts, so it is not intended for public deployment.

## What It Can Do

- Tracks applications across `Saved`, `Applied`, `Interview`, `Offer`, `Rejected`, and `Archived`.
- Offers a drag-and-drop Kanban board and a sortable Table with search, filtering, and multi-select.
- Stores each application's details, source links, job description, and autosaved notes.
- Keeps one CV, uploaded as `.txt`, `.pdf`, or `.docx` or pasted as text.
- Compares the CV with a job description using Gemini and shows evidence for every requirement.
- Imports and exports applications as `.xlsx`.
- Supports Light, Dark, and System themes.

## How It Works

1. Applications, the CV, and saved analyses are stored in browser `localStorage`.
2. FastAPI serves the built frontend and two API routes: CV text extraction and job analysis.
3. On **Analyze**, only the CV text and job description go to the local server, which calls Gemini with a server-side key.
4. The server validates the structured response, checks every quoted excerpt against the source text, and derives the overall assessment from the validated requirements.

The analysis gives no percentage score or coaching. It checks textual support only and cannot confirm real-world competence or eligibility. Job descriptions and CVs may be English, Turkish, or mixed; the interface and generated text are English.

## Technologies

- **Frontend:** HTML, CSS, TypeScript, Vite
- **Backend:** Python, FastAPI, Uvicorn
- **AI:** Google Gemini (server-side only)
- **Documents:** pypdf, python-docx, dependency-free XLSX import/export
- **Storage:** browser `localStorage`
- **Tests:** Node test runner and Python `unittest`

## Setup

Requirements:

- Python 3.10+
- Node.js 20.19+
- A Gemini API key (optional, only for AI analysis)

Install backend dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp -n backend/.env.example backend/.env
```

To enable AI analysis, set the key in `backend/.env`. Never put it in frontend code or a `VITE_*` variable.

For an existing installation, rerun `pip install -r backend/requirements.txt` to apply the required document-parser security updates. Create `backend/.env` only if it does not already exist; preserve existing credentials and settings.

```dotenv
GEMINI_API_KEY=your-key-here
```

Build the frontend:

```bash
cd frontend
npm ci
npm run build
cd ..
```

Start the app from the repository root:

```bash
python run.py
```

The app opens at `http://localhost:8000`. Use `PORT=9000 python run.py` for another port. After frontend changes, run `npm run build` again.

For frontend development with hot reload, keep `python run.py` running and start `npm run dev` in `frontend/`, then open `http://127.0.0.1:5173`. If the backend uses another port, set `APPLYPILOT_BACKEND_URL` in `frontend/.env.local`.

Basic checks:

```bash
cd frontend && npm run typecheck && npm test && npm run build
cd .. && .venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

Tests use mock transports and synthetic data; they never call Gemini.

## Project Structure

```text
ApplyPilot/
├── backend/             # FastAPI routes, Gemini client, validation, rate limits
├── frontend/
│   ├── assets/          # logo and favicon
│   ├── css/             # themes and styles
│   └── src/             # TypeScript application
├── tests/               # frontend and backend tests
└── run.py               # local launcher
```

## Data and Privacy

- All data lives in this browser profile. Clearing site data or switching browsers removes it.
- Use one active editing tab. Application edits are not synchronized across tabs; concurrent edits can overwrite each other. In-flight analysis separately detects cross-tab storage changes and discards its result.
- Use **Export to Excel** regularly to back up application tracking fields. Excel is not a full backup: it excludes the CV, original file, structured requirement evidence, and analysis fingerprints. Keep your original CV separately; imported analysis summaries are marked imported and require re-analysis.
- Only CV text and the job description are sent to Google when you click **Analyze**. Tracking notes, company/title metadata, and source URLs are excluded.
- Analysis uses `gemini-3.8-flash`, explicit low thinking, and a 16,384-token combined thinking/JSON ceiling. The ceiling is not a target; concise responses and server-derived summaries reduce generation. See `backend/.env.example` for supported configuration. Other models require compatibility review.
- Each action makes one provider request, or at most two when job evidence needs repair. Both share a total deadline of at most 90 seconds; the browser stops waiting at 100 seconds. Repair requires at least 15 seconds remaining. Truncated or explicitly incomplete responses are never accepted or blindly retried.
- Quotations are checked using NFC/whitespace tolerance while preserving case and punctuation. Conservative checks catch recognizable technology, negation, duration, proficiency, and credential conflicts. They do not prove every semantic judgment. Possible missing named qualifications are disclosed in the existing assessment text.
- Results are discarded if the CV, description, application identity, or existing analysis changes while a request runs. Older results remain available; pre-fix fingerprints require re-analysis to be current.
- Disconnects cancel local provider work where ASGI reports them; cancellation cannot guarantee Google stops already-started generation or billing. Rate and concurrency limits remain in memory per server process.
- The server binds to `127.0.0.1`, validates Host headers, and rate-limits analysis requests. Limits and timeouts are documented in [backend/.env.example](backend/.env.example).
- API requests with a browser Origin must match the serving origin or an explicitly configured CORS origin. CORS is not authentication. Alternate Uvicorn commands can override the loopback binding; keep this unauthenticated server local and use one worker because limits are per process.
- Document uploads have byte, page, extracted-text, and DOCX expansion limits, but parsing runs in threads without a hard CPU/memory sandbox. A hostile PDF can still consume substantial resources. Open only CV files you trust.
- Google Fonts is fetched when the page loads, independently of AI analysis; this discloses ordinary connection metadata to Google, not CV or application text.
- Scanned PDFs without selectable text are not supported.

## License

The project is available under the [MIT License](LICENSE).

<div align="center">
  <p>Built by <a href="https://heykaan.dev">heykaan.dev</a>.</p>
</div>
