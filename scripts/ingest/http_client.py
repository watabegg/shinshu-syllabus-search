"""Polite, redirect-validated HTTP access to the public syllabus host."""

from __future__ import annotations

import email.utils
import math
import time
from datetime import datetime, timezone
from typing import Any

import requests

from .common import MAX_PDF_BYTES, REQUEST_TIMEOUT, canonical_url

MAX_SERVER_RETRY_WAIT = 60.0


class PublicHttpClient:
    def __init__(self, delay: float = 1.0, timeout: int = REQUEST_TIMEOUT, retries: int = 3):
        self.delay = max(0.0, delay)
        self.timeout = timeout
        self.retries = retries
        self._last_request = 0.0
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "ShinshuSyllabusSearch/1.0 (public syllabus index; contact: project maintainers)",
            "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.1",
        })

    def _pace(self) -> None:
        remaining = self.delay - (time.monotonic() - self._last_request)
        if remaining > 0:
            time.sleep(remaining)
        self._last_request = time.monotonic()

    @staticmethod
    def _retry_after(response: requests.Response | None, attempt: int) -> float:
        if response is not None:
            value = response.headers.get("Retry-After", "").strip()
            if value:
                try:
                    seconds = float(value)
                    if math.isfinite(seconds):
                        return max(0.0, seconds)
                except ValueError:
                    pass
                try:
                    retry_date = email.utils.parsedate_to_datetime(value)
                    if retry_date.tzinfo is None:
                        retry_date = retry_date.replace(tzinfo=timezone.utc)
                    return max(0.0, (retry_date - datetime.now(timezone.utc)).total_seconds())
                except (TypeError, ValueError, OverflowError):
                    pass
        return min(8.0, 0.5 * (2 ** attempt))

    def get(self, url: str, *, headers: dict[str, str] | None = None,
            max_bytes: int | None = None) -> tuple[requests.Response, bytes, str]:
        current = canonical_url(url)
        for redirect in range(6):
            for attempt in range(self.retries + 1):
                self._pace()
                response: requests.Response | None = None
                try:
                    # Public syllabus access must not carry cookies between
                    # responses. Requests stores Set-Cookie values on a
                    # Session automatically, so clear both before and after
                    # each request rather than allowing a later index/PDF
                    # request to replay them.
                    self.session.cookies.clear()
                    response = self.session.get(current, headers=headers, timeout=self.timeout,
                                                 allow_redirects=False, stream=True)
                    self.session.cookies.clear()
                    if response.is_redirect or response.is_permanent_redirect:
                        if redirect == 5:
                            raise ValueError(f"too many redirects from {url}")
                        target = response.headers.get("Location")
                        if not target:
                            raise ValueError(f"redirect has no Location header: {current}")
                        next_url = canonical_url(target, current)
                        response.close()
                        current = next_url
                        break
                    if response.status_code == 304:
                        response.close()
                        return response, b"", current
                    if response.status_code == 429 or response.status_code >= 500:
                        if attempt >= self.retries:
                            response.raise_for_status()
                        delay = self._retry_after(response, attempt)
                        retry_after = response.headers.get("Retry-After", "").strip()
                        response.close()
                        if retry_after and delay > MAX_SERVER_RETRY_WAIT:
                            raise RuntimeError(
                                f"server requested Retry-After of {delay:.0f}s, above the "
                                f"{MAX_SERVER_RETRY_WAIT:.0f}s automatic wait bound; deferred without retry: {current}"
                            )
                        time.sleep(delay)
                        continue
                    response.raise_for_status()
                    chunks: list[bytes] = []
                    size = 0
                    for chunk in response.iter_content(chunk_size=64 * 1024):
                        if not chunk:
                            continue
                        size += len(chunk)
                        if max_bytes is not None and size > max_bytes:
                            response.close()
                            raise ValueError(f"response exceeded {max_bytes} byte limit")
                        chunks.append(chunk)
                    return response, b"".join(chunks), current
                except (requests.RequestException, OSError) as exc:
                    self.session.cookies.clear()
                    if response is not None:
                        response.close()
                    if attempt >= self.retries:
                        raise RuntimeError(f"request failed after {self.retries + 1} attempts: {current}: {exc}") from exc
                    time.sleep(self._retry_after(response, attempt))
            else:
                continue
            # The `break` is reached only after validating a redirect target.
            continue
        raise RuntimeError(f"could not complete request for {url}")

    def get_html(self, url: str) -> tuple[str, dict[str, Any]]:
        response, body, final_url = self.get(url, max_bytes=5 * 1024 * 1024)
        content_type = response.headers.get("Content-Type", "").lower()
        if "html" not in content_type and not body.lstrip().startswith((b"<!doctype html", b"<html")):
            raise ValueError(f"expected HTML from {final_url}, received {content_type or 'unknown content type'}")
        encoding = response.encoding or "utf-8"
        return body.decode(encoding, errors="replace"), {
            "final_url": final_url, "http_status": response.status_code,
            "content_type": content_type, "etag": response.headers.get("ETag"),
            "last_modified": response.headers.get("Last-Modified"),
        }

    def get_pdf(self, url: str, *, headers: dict[str, str] | None = None) -> tuple[requests.Response, bytes, str]:
        return self.get(url, headers=headers, max_bytes=MAX_PDF_BYTES)
