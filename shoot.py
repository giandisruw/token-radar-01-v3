"""Render the v3 dashboard's three screenshots with headless Chromium
(via the Python Playwright package; browsers already installed).

Views (1440x900, as the gate requires: long side <= 1440, short side >= 800):
  1-board.jpg    — the board as it loads (top rows, cost columns, method note)
  2-detail.jpg   — detail view open for the rank-1 protocol, with its costed farm plan
  3-filtered.jpg — watchlist-only filter applied
Output JPEGs are tuned to land in the 300-350 KB band the rules recommend.
"""
import json
import os

from PIL import Image
from playwright.sync_api import sync_playwright

SHOTS = "/home/hatch/workspace/makefun-token-radar-01-v3/screenshots"
TOP_SLUG = json.load(open("/tmp/radar-v3-out/board.json"))["rows"][0]["slug"]
print("rank-1 slug:", TOP_SLUG)

os.makedirs("/tmp/radar-v3-shots", exist_ok=True)
views = [
    ("1-board", "index.html"),
    ("2-detail", "index.html#detail=" + TOP_SLUG),
    ("3-filtered", "index.html#filter=watchlist"),
]
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for name, url in views:
        # A fresh page per view: navigating only the hash would not reload
        # the page, so the hash-driven initial state would never run.
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto("file:///tmp/radar-v3-out/dashboard/" + url, wait_until="load")
        page.wait_for_timeout(600)
        page.screenshot(path=f"/tmp/radar-v3-shots/{name}.png")
        print("shot", name)
        page.close()
    browser.close()

for name, _ in views:
    im = Image.open(f"/tmp/radar-v3-shots/{name}.png").convert("RGB")
    print(name, "rendered", im.size)
    # Binary-search JPEG quality into the 300-350 KB band.
    lo, hi, best = 50, 96, None
    for _ in range(8):
        q = (lo + hi) // 2
        im.save("/tmp/radar-v3-shots/test.jpg", quality=q, optimize=True)
        size = os.path.getsize("/tmp/radar-v3-shots/test.jpg")
        if size > 350_000:
            hi = q - 1
        elif size < 300_000:
            lo = q + 1
            best = (q, size)
        else:
            best = (q, size)
            break
    if best is None:
        q = lo
        im.save("/tmp/radar-v3-shots/test.jpg", quality=q, optimize=True)
        best = (q, os.path.getsize("/tmp/radar-v3-shots/test.jpg"))
    im.save(f"{SHOTS}/{name}.jpg", quality=best[0], optimize=True)
    print(f"{name}.jpg: quality={best[0]} size={os.path.getsize(f'{SHOTS}/{name}.jpg')} bytes")
