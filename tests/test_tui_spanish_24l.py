"""Comprueba cambio a spanish_24l, F5 durante carga y rechazo de doble reproducción.

Reproduce audio. Desde la raíz:
.venv-pocket/Scripts/python tests/test_tui_spanish_24l.py
Linux/macOS: .venv-pocket/bin/python tests/test_tui_spanish_24l.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from tehablo_tui import TehabloApp
from textual.widgets import RichLog, Select, TextArea


async def wait(pilot, cond, secs=300):
    for _ in range(secs * 2):
        await pilot.pause(0.5)
        if cond():
            return True
    return False


async def main():
    app = TehabloApp()
    async with app.run_test(size=(120, 40)) as pilot:
        await wait(pilot, lambda: app.model_name == "spanish")
        app.query_one("#model", Select).value = "spanish_24l"
        app.query_one("#text", TextArea).text = "Prueba con el modelo de mayor calidad."
        await pilot.pause(0.2)
        await pilot.press("f5")  # pressed once, while the model is still loading
        await pilot.press("f5")  # second press during playback must be rejected
        await pilot.pause(1)
        await wait(pilot, lambda: not app.speaking and not app.loading)
        print("model_name:", app.model_name)
        for line in app.query_one("#log", RichLog).lines:
            print("LOG:", line.text)


asyncio.run(main())
