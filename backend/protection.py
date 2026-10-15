"""Small in-memory guards for the unauthenticated paid analysis endpoint."""

from __future__ import annotations

import asyncio
import math
import threading
import time
from collections import defaultdict, deque


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int):
        super().__init__("rate limit exceeded")
        self.retry_after = max(1, retry_after)


class SlidingWindowLimiter:
    def __init__(self, client_limit: int, global_limit: int, window_seconds: int = 60):
        self.client_limit = client_limit
        self.global_limit = global_limit
        self.window_seconds = window_seconds
        self._clients: dict[str, deque[float]] = defaultdict(deque)
        self._global: deque[float] = deque()
        self._lock = threading.Lock()

    def check(self, client: str, now: float | None = None) -> None:
        timestamp = time.monotonic() if now is None else now
        cutoff = timestamp - self.window_seconds
        with self._lock:
            while self._global and self._global[0] <= cutoff:
                self._global.popleft()
            bucket = self._clients[client]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            waits = []
            if len(bucket) >= self.client_limit:
                waits.append(bucket[0] + self.window_seconds - timestamp)
            if len(self._global) >= self.global_limit:
                waits.append(self._global[0] + self.window_seconds - timestamp)
            if waits:
                raise RateLimitExceeded(math.ceil(max(waits)))

            bucket.append(timestamp)
            self._global.append(timestamp)

    def reset(self) -> None:
        with self._lock:
            self._clients.clear()
            self._global.clear()


class CapacityGuard:
    """Reject immediately at capacity; never build an unbounded wait queue."""

    def __init__(self, limit: int):
        self.limit = limit
        self._active = 0
        self._lock = asyncio.Lock()

    async def try_acquire(self) -> bool:
        async with self._lock:
            if self._active >= self.limit:
                return False
            self._active += 1
            return True

    async def release(self) -> None:
        async with self._lock:
            self._active = max(0, self._active - 1)

    async def reset(self) -> None:
        async with self._lock:
            self._active = 0
