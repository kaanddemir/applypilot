"""Start ApplyPilot's local FastAPI server. Ctrl+C stops it cleanly."""

from __future__ import annotations

import importlib.util
import os
import socket
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND_BUILD = ROOT / "frontend" / "dist" / "index.html"
DEFAULT_PORT = 8000


def _paint(tty: bool):
    """Return terminal colouring, disabled when output is piped."""
    codes = {"bold": "1", "dim": "2", "green": "32", "yellow": "33"}

    def paint(text: str, *styles: str) -> str:
        if not tty:
            return text
        prefix = "".join(f"\033[{codes[style]}m" for style in styles)
        return f"{prefix}{text}\033[0m"

    return paint


REQUIRED_PACKAGES = (
    ("fastapi", "FastAPI"),
    ("uvicorn", "Uvicorn"),
    ("multipart", "python-multipart"),
    ("httpx", "httpx"),
    ("dotenv", "python-dotenv"),
    ("pypdf", "pypdf"),
    ("docx", "python-docx"),
)


def _problem(paint, title: str, *fix: str) -> str:
    """Format setup and launch failures as short actionable notices."""
    lines = ["", f"  {paint(title, 'yellow')}"]
    lines.extend(f"  {paint(line, 'dim')}" for line in fix)
    lines.append("")
    return "\n".join(lines)


def _missing_packages() -> list[str]:
    missing = []
    for module_name, label in REQUIRED_PACKAGES:
        try:
            found = importlib.util.find_spec(module_name) is not None
        except (ImportError, ValueError):
            found = False
        if not found:
            missing.append(label)
    return missing


def _venv_python() -> Path | None:
    for relative in ("bin/python", "Scripts/python.exe"):
        candidate = ROOT / ".venv" / relative
        if candidate.exists():
            return candidate
    return None


def _running_in_venv() -> bool:
    return Path(sys.prefix).resolve() == (ROOT / ".venv").resolve()


def _reexec_into_venv() -> None:
    venv_python = _venv_python()
    if venv_python is not None and not _running_in_venv():
        os.execv(str(venv_python), [str(venv_python), str(Path(__file__).resolve()), *sys.argv[1:]])


def _setup_problem(paint) -> str | None:
    missing = _missing_packages()
    if missing:
        fixes = [] if _venv_python() else ["python -m venv .venv", "source .venv/bin/activate"]
        return _problem(
            paint,
            f"Missing dependencies: {', '.join(missing)}.",
            *fixes,
            "pip install -r backend/requirements.txt",
        )
    if not FRONTEND_BUILD.is_file():
        return _problem(
            paint,
            "Frontend build is missing.",
            "cd frontend",
            "npm install",
            "npm run build",
            "cd .. && python run.py",
        )
    return None


def _port_setting(paint) -> tuple[int | None, str | None]:
    raw = os.environ.get("PORT", str(DEFAULT_PORT)).strip()
    try:
        port = int(raw)
    except ValueError:
        return None, _problem(paint, f"PORT must be an integer between 1 and 65535; received {raw!r}.")
    if not 1 <= port <= 65535:
        return None, _problem(paint, f"PORT must be between 1 and 65535; received {raw!r}.")
    return port, None


def _port_is_free(port: int) -> bool:
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _port_in_use(port: int, paint) -> str:
    return "\n".join((
        "",
        f"  {paint(f'Port {port} is already in use.', 'yellow')}",
        f"  {paint('Another copy is probably still running. Stop it there with', 'dim')}",
        f"  {paint('Ctrl+C, or start this one elsewhere:', 'dim')}",
        "",
        f"      PORT={port + 1} python run.py",
        "",
    ))


def _banner(port: int, reload_enabled: bool, gemini_configured: bool, paint) -> str:
    ai_value = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash").strip() or "gemini-3.8-flash"
    rows = [
        ("Open", paint(f"http://localhost:{port}", "bold")),
        ("AI", ai_value if gemini_configured else "unavailable (GEMINI_API_KEY not set)"),
        ("Stop", "Ctrl+C"),
    ]
    lines = [
        "",
        f"  {paint('ApplyPilot', 'bold', 'green')}",
        f"  {paint('─' * 44, 'dim')}",
    ]
    lines.extend(f"  {paint(label.ljust(10), 'dim')}{value}" for label, value in rows)
    if not gemini_configured:
        lines.extend((
            "",
            f"  {paint('! Gemini analysis is unavailable until GEMINI_API_KEY is configured.', 'yellow')}",
        ))
    if reload_enabled:
        lines.extend((
            "",
            f"  {paint('! Auto-reload on: the server restarts on every backend change.', 'yellow')}",
        ))
    lines.append("")
    return "\n".join(lines)


def _put_backend_on_path() -> None:
    backend = str(BACKEND)
    if backend not in sys.path:
        sys.path.insert(0, backend)
    existing = os.environ.get("PYTHONPATH", "")
    if backend not in existing.split(os.pathsep):
        os.environ["PYTHONPATH"] = f"{backend}{os.pathsep}{existing}" if existing else backend


def _accepts(port: int) -> bool:
    with socket.socket() as probe:
        probe.settimeout(0.1)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def _report_ready(port: int, ready: threading.Event, finished: threading.Event, paint) -> None:
    while not finished.is_set():
        if _accepts(port):
            ready.set()
            print(f"  {paint('✓', 'green')} Server ready", flush=True)
            return
        time.sleep(0.05)


def main() -> int:
    paint = _paint(sys.stdout.isatty())
    _reexec_into_venv()

    problem = _setup_problem(paint)
    if problem:
        print(problem, file=sys.stderr, flush=True)
        return 1

    port, problem = _port_setting(paint)
    if problem:
        print(problem, file=sys.stderr, flush=True)
        return 1
    assert port is not None
    if not _port_is_free(port):
        print(_port_in_use(port, paint), file=sys.stderr, flush=True)
        return 1

    _put_backend_on_path()
    from dotenv import load_dotenv

    load_dotenv(BACKEND / ".env")
    gemini_configured = bool(os.environ.get("GEMINI_API_KEY", "").strip())

    import uvicorn

    reload_enabled = os.environ.get("RELOAD", "").strip().lower() in {"1", "true", "yes", "on"}
    log_level = os.environ.get("LOG_LEVEL", "warning").strip().lower() or "warning"
    if log_level not in {"critical", "error", "warning", "info", "debug", "trace"}:
        print(_problem(paint, f"LOG_LEVEL is invalid: {log_level!r}."), file=sys.stderr, flush=True)
        return 1
    finished = threading.Event()
    ready = threading.Event()
    reporter = threading.Thread(target=_report_ready, args=(port, ready, finished, paint), daemon=True)

    print(_banner(port, reload_enabled, gemini_configured, paint), flush=True)
    reporter.start()
    try:
        uvicorn.run(
            "app:app",
            host="127.0.0.1",
            port=port,
            reload=reload_enabled,
            reload_dirs=[str(BACKEND)] if reload_enabled else None,
            log_level=log_level,
            access_log=log_level == "debug",
        )
    except KeyboardInterrupt:
        pass
    finally:
        finished.set()
        reporter.join(timeout=0.2)

    if not ready.is_set():
        print(_problem(paint, "ApplyPilot stopped before becoming ready.", "The server error is above."), file=sys.stderr, flush=True)
        return 1
    print(f"\n  {paint('Stopped.', 'dim')}\n", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
