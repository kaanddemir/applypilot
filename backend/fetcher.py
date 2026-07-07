"""Fetch a job-posting URL and extract clean, readable text.

Strategy: pull the HTML with httpx, then extract the main content with
trafilatura (which strips nav/boilerplate). Fall back to a BeautifulSoup
text dump if trafilatura finds nothing. Empty or suspiciously short results,
and obvious login/error pages, are reported as "could not read" so the caller
can ask the user to paste the description directly instead of sending garbage
to the model.
"""

from __future__ import annotations

import re

import httpx
import trafilatura
from bs4 import BeautifulSoup

# A normal browser-ish UA; some sites refuse the default httpx agent.
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# Below this many characters, treat the extraction as a failure.
_MIN_USABLE_CHARS = 200

# Phrases that strongly suggest a login wall or error page rather than a posting.
_BLOCK_SIGNS = (
    "sign in to continue",
    "log in to continue",
    "please enable javascript",
    "access denied",
    "are you a robot",
    "verify you are human",
    "page not found",
    "404 not found",
)


class FetchError(Exception):
    """Raised when a posting URL cannot be read into usable text."""


def _looks_like_block_page(text: str) -> bool:
    low = text.lower()
    return any(sign in low for sign in _BLOCK_SIGNS)


def _clean(text: str) -> str:
    # Collapse excessive blank lines and trailing whitespace.
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def fetch_job_posting(url: str, timeout: float = 15.0) -> str:
    """Return cleaned posting text for ``url``.

    Raises ``FetchError`` if the page cannot be fetched or yields no usable text.
    """
    url = url.strip()
    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise FetchError("Please provide a full URL starting with http:// or https://")

    try:
        with httpx.Client(
            follow_redirects=True,
            timeout=timeout,
            headers={"User-Agent": _USER_AGENT, "Accept-Language": "en"},
        ) as client:
            resp = client.get(url)
            resp.raise_for_status()
            html = resp.text
    except httpx.HTTPError as exc:
        raise FetchError(f"Could not fetch the URL: {exc}") from exc

    # Primary: trafilatura main-content extraction.
    extracted = trafilatura.extract(
        html,
        include_comments=False,
        include_tables=True,
        favor_recall=True,
    )

    # Fallback: strip scripts/styles and dump visible text.
    if not extracted or len(extracted.strip()) < _MIN_USABLE_CHARS:
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript", "nav", "footer", "header"]):
            tag.decompose()
        extracted = soup.get_text(separator="\n")

    text = _clean(extracted or "")

    if len(text) < _MIN_USABLE_CHARS or _looks_like_block_page(text):
        raise FetchError(
            "The posting could not be read (it may be behind a login wall or "
            "rendered with JavaScript). Please paste the job description text directly."
        )

    return text
