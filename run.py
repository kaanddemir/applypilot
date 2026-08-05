"""Entrypoint: `python run.py` starts ApplyPilot. Ctrl+C stops it.

Uvicorn cannot say anything useful about a first run that fails on setup: a
missing dependency arrives as an import error several frames deep, and a taken
port as a bare "Address already in use". Everything below runs before the
server does, so the first thing anyone sees is either the banner or the one
command that fixes what is missing.
"""

import importlib.util
import logging
import os
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

DEFAULT_PORT = 8000

# Import name -> what to say it is, in the order the app needs them.
REQUIRED_PACKAGES = (
    ("fastapi", "FastAPI"),
    ("uvicorn", "Uvicorn"),
    ("multipart", "python-multipart"),
    # Imported lazily inside the upload handler, one per file type. Without a
    # check here a missing one stays invisible until someone uploads a CV,
    # which is the worst moment to find out.
    ("pypdf", "pypdf"),
    ("docx", "python-docx"),
)


def _paint(tty):
    """Return a colouring function that is a no-op unless stdout is a terminal."""
    codes = {"bold": "1", "dim": "2", "green": "32", "yellow": "33"}

    def paint(text, *styles):
        if not tty:
            return text
        prefix = "".join(f"\033[{codes[style]}m" for style in styles)
        return f"{prefix}{text}\033[0m"

    return paint


def _problem(paint, title, *fix):
    """Format a setup problem as the one thing to read and the command to run."""
    lines = ["", f"  {paint(title, 'yellow')}"]
    lines += [f"  {paint(line, 'dim')}" for line in fix]
    lines.append("")
    return "\n".join(lines)


def _missing_packages():
    """Which required distributions are not importable, by display name.

    ``find_spec`` locates a package without importing it, so the check costs
    nothing on the runs after the first, where it always passes.
    """
    missing = []
    for module_name, label in REQUIRED_PACKAGES:
        try:
            found = importlib.util.find_spec(module_name) is not None
        except (ImportError, ValueError):
            found = False
        if not found:
            missing.append(label)
    return missing


def _venv_python():
    """The project venv's interpreter, if that venv exists."""
    for relative in ("bin/python", "Scripts/python.exe"):
        candidate = ROOT / ".venv" / relative
        if candidate.exists():
            return candidate
    return None


def _running_in_venv():
    """Whether this interpreter is the project venv's.

    Compares prefixes rather than executables: a venv's `python` is usually a
    symlink to the interpreter it was built from, so resolving the two paths
    makes them equal even when the imports differ.
    """
    return Path(sys.prefix).resolve() == (ROOT / ".venv").resolve()


def _reexec_into_venv():
    """Hand the process to the venv interpreter, or return if there is none.

    `python run.py` without activating first is the ordinary way to start
    this, and it fails on every import while the packages sit one directory
    away. Switching interpreters is what the activation would have done, so
    it happens here instead of being explained in an error.
    """
    venv_python = _venv_python()
    if venv_python is None or _running_in_venv():
        return
    os.environ["APPLYPILOT_REEXEC"] = "1"
    os.execv(str(venv_python), [str(venv_python), str(Path(__file__).resolve()), *sys.argv[1:]])


def _python_hint():
    """How to get an interpreter that has the dependencies.

    Only reached when the venv is missing or when it is the venv itself that
    is short a package — anything else has already been switched over.
    """
    if _venv_python() is None:
        return ("python -m venv .venv", "source .venv/bin/activate")
    return ()


def _setup_problem(paint):
    """Return the first missing piece of local setup, or None if all is present."""
    missing = _missing_packages()
    if missing:
        return _problem(
            paint,
            f"Missing dependencies: {', '.join(missing)}.",
            *_python_hint(),
            "pip install -r backend/requirements.txt",
        )
    return None


def _banner(port, reload_enabled, paint):
    rows = [
        ("Open", paint(f"http://localhost:{port}", "bold")),
        # Both rows answer the question this app invites: where does my CV go,
        # and where does my provider key go. Neither reaches this server.
        ("AI", "in your browser, keys never reach this server"),
        ("Data", "browser localStorage"),
        ("Stop", "Ctrl+C"),
    ]
    lines = [
        "",
        f"  {paint('ApplyPilot', 'bold', 'green')}",
        f"  {paint('─' * 44, 'dim')}",
    ]
    lines += [f"  {paint(label.ljust(10), 'dim')}{value}" for label, value in rows]
    if reload_enabled:
        lines += [
            "",
            f"  {paint('! Auto-reload on: the server restarts on every file change.', 'yellow')}",
        ]
    lines.append("")
    return "\n".join(lines)


def _port_is_free(port):
    """Whether the app can still take `port`, checked before Uvicorn does.

    Uvicorn handles this failure itself and exits with a bare "Address already
    in use", which does not say what is holding the port or what to do about
    it. Asking first is what keeps the message ours.
    """
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _port_in_use(port, paint):
    return "\n".join((
        "",
        f"  {paint('Port ' + str(port) + ' is already in use.', 'yellow')}",
        f"  {paint('Another copy is probably still running. Stop it there with', 'dim')}",
        f"  {paint('Ctrl+C, or start this one elsewhere:', 'dim')}",
        "",
        f"      PORT={port + 1} python run.py",
        "",
    ))


def _quiet_framework_output(log_level):
    """Silence Uvicorn's startup notes and its per-request access log.

    Uvicorn logs one line per request, and the frontend is a few dozen static
    files, so a single page load buries anything the app itself has to say.
    LOG_LEVEL=DEBUG is the way back to all of it.
    """
    if log_level == "DEBUG":
        return
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def _put_backend_on_path():
    """Make `backend/` importable, the way running from inside it would.

    `backend/app.py` imports its sibling `prompts` by bare name, so the target
    is `app:app` with `backend/` on the path. The env var is what carries this
    into the reloader: it re-imports in a fresh subprocess that inherits the
    environment but not this process's `sys.path`.
    """
    backend = str(BACKEND)
    if backend not in sys.path:
        sys.path.insert(0, backend)
    existing = os.environ.get("PYTHONPATH", "")
    if backend not in existing.split(os.pathsep):
        os.environ["PYTHONPATH"] = f"{backend}{os.pathsep}{existing}" if existing else backend


def main():
    paint = _paint(sys.stdout.isatty())
    _reexec_into_venv()

    if os.environ.get("APPLYPILOT_REEXEC") == "1":
        # Said once, because which interpreter is serving is worth knowing when
        # the one that was typed is not the one that ended up running.
        print(f"\n  {paint('Switched to .venv, where the dependencies are.', 'dim')}", flush=True)

    problem = _setup_problem(paint)
    if problem:
        print(problem, flush=True)
        return 1

    port = int(os.environ.get("PORT", DEFAULT_PORT))
    if not _port_is_free(port):
        print(_port_in_use(port, paint), flush=True)
        return 1

    reload_enabled = os.environ.get("RELOAD", "").strip().lower() in {"1", "true", "yes", "on"}
    log_level = os.environ.get("LOG_LEVEL", "").strip().upper()

    _put_backend_on_path()

    import uvicorn

    _quiet_framework_output(log_level)

    # flush: a piped stdout is block-buffered, and a banner that only appears
    # once the server is stopped is worse than none.
    print(_banner(port, reload_enabled, paint), flush=True)

    try:
        uvicorn.run(
            "app:app",
            host="127.0.0.1",
            port=port,
            reload=reload_enabled,
            # The frontend is served as static files, so a change there needs no
            # restart. Watching only the backend keeps editing CSS from cycling
            # the server underneath the browser.
            reload_dirs=[str(BACKEND)] if reload_enabled else None,
            log_level=log_level.lower() if log_level else "warning",
        )
    except KeyboardInterrupt:
        pass

    # The opposite of what the sibling apps say on the way out: nothing of the
    # user's was ever in this process to lose.
    print(f"\n  {paint('Stopped. Your applications stay in the browser.', 'dim')}\n", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
