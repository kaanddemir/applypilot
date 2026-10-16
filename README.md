# ApplyPilot

<div align="center">
  <img src="frontend/assets/logo.png" alt="ApplyPilot Logo" width="120" />

**A local job application tracker with evidence-based AI job fit analysis.**
</div>

## What Is ApplyPilot?

ApplyPilot keeps your job search in one place: applications on a Kanban board or table, the job description and notes for each one, a single saved CV, and an optional Gemini comparison of that CV against a posting.

It is a single-user local application. Data stays in your browser and the Gemini key stays on the local server. There are no user accounts, so it is not intended for public deployment.

## What Can It Do?

- Tracks applications across `Saved`, `Applied`, `Interview`, `Offer`, `Rejected` and `Archived`.
- Offers a drag-and-drop Kanban board and a sortable table with search, filtering and multi-select.
- Stores each application's details, source links, job description and autosaved notes.
- Keeps one CV, uploaded as `.txt`, `.pdf` or `.docx`, or pasted as text.
- Compares the CV with a job description using Gemini and shows evidence for every requirement.
- Imports and exports applications as `.xlsx`.
- Supports Light, Dark and System themes.

## How Does It Work?

1. You add applications and your CV; they are stored in the browser's `localStorage`.
2. FastAPI serves the built frontend and two API routes: CV text extraction and job analysis.
3. When you click **Analyze**, only the CV text and job description go to the local server, which calls Gemini with a server-side key.
4. The server validates the structured response and checks every quoted excerpt against the source text.
5. The overall assessment is derived from the validated requirements and shown in the interface.

The analysis gives no percentage score or coaching. It checks textual support only and cannot confirm real-world competence or eligibility. Job descriptions and CVs may be English, Turkish or mixed; the interface and generated text are English.

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

To enable AI analysis, set the key in `backend/.env`:

```dotenv
GEMINI_API_KEY=your-key-here
```

Never put the key in frontend code or a `VITE_*` variable.

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

All data stays in your browser; use **Export to Excel** to back up your applications. Only the CV text and job description are sent to Google, and only when you click **Analyze**. The server runs locally on `127.0.0.1`.

## License

The project is available under the [MIT License](LICENSE).

<div align="center">
  <p>Developed by <a href="https://heykaan.dev">heykaan.dev</a>.</p>
</div>
