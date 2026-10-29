"""Speech speed control that keeps the voice pitch, applied while audio streams.

Pocket TTS has no speaking-rate option, so the generated audio is time-stretched
with WSOLA (audiotsm). Speed 1 passes audio through untouched.
"""

import numpy as np
from audiotsm import wsola
from audiotsm.io.array import ArrayReader, ArrayWriter

SPEEDS = (0.75, 0.9, 1.0, 1.1, 1.25, 1.5)
# audiotsm drops the last partial frame (~1 frame); feeding this much silence
# before flushing keeps the end of the last word.
_TAIL_PADDING = 2048


class SpeedStream:
    """Time-stretch mono float audio chunk by chunk; call flush() after the last chunk."""

    def __init__(self, speed: float):
        if speed <= 0:
            raise ValueError("speed must be > 0")
        self._tsm = None if speed == 1.0 else wsola(channels=1, speed=speed)

    def process(self, chunk: np.ndarray) -> np.ndarray:
        if self._tsm is None or chunk.size == 0:
            return chunk
        writer = ArrayWriter(channels=1)
        self._tsm.run(ArrayReader(chunk.reshape(1, -1)), writer, flush=False)
        return writer.data[0].astype(np.float32)

    def flush(self) -> np.ndarray:
        if self._tsm is None:
            return np.zeros(0, dtype=np.float32)
        writer = ArrayWriter(channels=1)
        padding = np.zeros((1, _TAIL_PADDING), dtype=np.float32)
        self._tsm.run(ArrayReader(padding), writer, flush=False)
        finished = False
        while not finished:
            _, finished = self._tsm.flush_to(writer)
        self._tsm.clear()
        return writer.data[0].astype(np.float32)
