"""Comprueba generación y guardado desde la TUI sin ventana; reproduce audio.

Desde la raíz: .venv-pocket/Scripts/python tests/test_tui_smoke.py
Linux/macOS: .venv-pocket/bin/python tests/test_tui_smoke.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from tehablo_tui import TehabloApp, list_voices
from textual.widgets import RichLog, Select, TextArea


async def main():
    app = TehabloApp()
    async with app.run_test(size=(120, 40)) as pilot:
        for _ in range(240):
            await pilot.pause(0.5)
            if app.model_name:
                break
        voices = list_voices()
        print("voices:", len(voices), "first:", voices[0])
        app.query_one("#voice", Select).value = "rafael"
        app.query_one("#text", TextArea).text = "Hola, esta es una prueba con una voz clonada."
        await pilot.press("f5")
        await pilot.pause(1)
        for _ in range(240):
            await pilot.pause(0.5)
            if not app.busy.locked():
                break
        await pilot.press("f7")
        await pilot.pause(0.5)
        for line in app.query_one("#log", RichLog).lines:
            print("LOG:", line.text)


asyncio.run(main())
