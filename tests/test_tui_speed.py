"""Checks the TUI speed selector end to end; plays audio through the speakers.

From the repo root: .venv-pocket/Scripts/python tests/test_tui_speed.py
Linux/macOS: .venv-pocket/bin/python tests/test_tui_speed.py
Generates the same text at 1x and 1.5x; exit code 0 means the 1.5x audio
is about 1.5 times shorter.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from tehablo_tui import TehabloApp
from textual.widgets import RichLog, Select, TextArea

TEXT = "Esta frase sirve para comparar la duracion del audio a distintas velocidades."


async def generate(app, pilot, speed: float) -> float:
    app.query_one("#speed", Select).value = speed
    await pilot.press("f5")
    await pilot.pause(1)
    for _ in range(240):
        await pilot.pause(0.5)
        if not app.speaking:
            break
    return len(app.last_audio) / app.model.sample_rate


async def main() -> int:
    app = TehabloApp()
    async with app.run_test(size=(140, 40)) as pilot:
        for _ in range(240):
            await pilot.pause(0.5)
            if app.model_name:
                break
        app.query_one("#text", TextArea).text = TEXT
        normal = await generate(app, pilot, 1.0)
        fast = await generate(app, pilot, 1.5)
        for line in app.query_one("#log", RichLog).lines:
            print("LOG:", line.text)
    ratio = normal / fast
    print(f"1x: {normal:.2f} s, 1.5x: {fast:.2f} s, ratio {ratio:.2f}")
    return 0 if 1.35 < ratio < 1.65 else 1


sys.exit(asyncio.run(main()))
