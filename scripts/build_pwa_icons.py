"""
Build PWA icons + logo PNG from TotemForge branding sources.

Priority for app icon / favicon:
  1. totemforge-icon.png — square master (recommended).
  2. Right-hand panel cut from a composite (totemforge-logo-icon.png → assets/branding-composite.png).

Outputs: favicon.ico (16+32), icon-192.png, icon-512.png, logo.png (left half of composite).

Pure Pillow (no numpy).
"""
from __future__ import annotations

import shutil
import sys
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

SQUARE_ICON = ROOT / "totemforge-icon.png"
COMPOSITE_PRIMARY = ROOT / "totemforge-logo-icon.png"
COMPOSITE_ASSETS = ROOT / "assets" / "branding-composite.png"
COMPOSITE_FALLBACK = Path(
    r"C:\Users\jade\.cursor\projects\c-totemforge\assets\c__Users_jade_AppData_Roaming_Cursor_User_workspaceStorage_36bef396fcec10e3f5eeda44b52c3d6d_images_image-4a833523-04f0-43ce-8189-b236390d4ec6.png"
)

PAD_FRAC = 0.11
BG_COLOR_TOL = 62
BG_MAX_LUM = 135


def composite_to_icon_panel(im: Image.Image) -> Image.Image:
    w, h = im.size
    x0 = int(w * 0.48)
    return im.crop((x0, 0, w, h))


def lum_px(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb
    return r * 0.299 + g * 0.587 + b * 0.114


def color_dist(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


def remove_dark_background_rgba(im: Image.Image) -> Image.Image:
    arr = im.convert("RGBA")
    w, h = arr.size
    px = arr.load()

    lum = [[0.0] * w for _ in range(h)]
    rgb = [[(0.0, 0.0, 0.0)] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            rgb[y][x] = (float(r), float(g), float(b))
            lum[y][x] = lum_px((r, g, b))

    visited = [[False] * w for _ in range(h)]
    kill = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def try_seed(y: int, x: int) -> None:
        if lum[y][x] <= BG_MAX_LUM and not visited[y][x]:
            visited[y][x] = True
            kill[y][x] = True
            q.append((y, x))

    for x in range(w):
        try_seed(0, x)
        try_seed(h - 1, x)
    for y in range(h):
        try_seed(y, 0)
        try_seed(y, w - 1)

    neigh = ((1, 0), (-1, 0), (0, 1), (0, -1))
    while q:
        cy, cx = q.popleft()
        ref = rgb[cy][cx]
        for dy, dx in neigh:
            ny, nx = cy + dy, cx + dx
            if ny < 0 or ny >= h or nx < 0 or nx >= w or visited[ny][nx]:
                continue
            visited[ny][nx] = True
            if lum[ny][nx] > BG_MAX_LUM:
                continue
            if color_dist(rgb[ny][nx], ref) <= BG_COLOR_TOL:
                kill[ny][nx] = True
                q.append((ny, nx))

    out = arr.copy()
    opx = out.load()
    for y in range(h):
        for x in range(w):
            if kill[y][x]:
                r, g, b, _ = opx[x, y]
                opx[x, y] = (r, g, b, 0)
    return out


def trim_alpha(im: Image.Image) -> Image.Image:
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def fit_center_pad_square(src: Image.Image, out_px: int, pad_frac: float) -> Image.Image:
    inner = max(1, int(round(out_px * (1 - 2 * pad_frac))))
    sw, sh = src.size
    scale = min(inner / sw, inner / sh)
    nw = max(1, int(round(sw * scale)))
    nh = max(1, int(round(sh * scale)))
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (out_px, out_px), (0, 0, 0, 0))
    ox = (out_px - nw) // 2
    oy = (out_px - nh) // 2
    canvas.paste(resized, (ox, oy), resized)
    return canvas


def resolve_composite_path() -> Path | None:
    for p in (COMPOSITE_PRIMARY, COMPOSITE_ASSETS, COMPOSITE_FALLBACK):
        if p.is_file():
            return p
    return None


def load_icon_rgba_from_sources() -> Image.Image:
    """Square master preferred; else composite right panel."""
    if SQUARE_ICON.is_file():
        rgba = Image.open(SQUARE_ICON).convert("RGBA")
        rgba = remove_dark_background_rgba(rgba)
        return trim_alpha(rgba)

    comp_path = resolve_composite_path()
    if not comp_path:
        raise FileNotFoundError(
            "Need totemforge-icon.png or a composite (totemforge-logo-icon.png / assets/branding-composite.png)."
        )

    panel = composite_to_icon_panel(Image.open(comp_path).convert("RGB"))
    rgba = panel.convert("RGBA")
    rgba = remove_dark_background_rgba(rgba)
    return trim_alpha(rgba)


def export_full_logo_png() -> Path | None:
    src = resolve_composite_path()
    if not src:
        return None
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    left_w = max(1, int(w * 0.48))
    logo = im.crop((0, 0, left_w, h))
    out = ROOT / "logo.png"
    logo.save(out, "PNG", optimize=True)
    return out


def sync_reference_composite() -> None:
    if COMPOSITE_FALLBACK.is_file() and COMPOSITE_ASSETS.parent.is_dir():
        shutil.copy2(COMPOSITE_FALLBACK, COMPOSITE_ASSETS)


def main() -> int:
    sync_reference_composite()

    try:
        rgba = load_icon_rgba_from_sources()
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        return 1

    icon192 = fit_center_pad_square(rgba, 192, PAD_FRAC)
    icon512 = fit_center_pad_square(rgba, 512, PAD_FRAC)
    fav32 = fit_center_pad_square(rgba, 32, PAD_FRAC)

    out192 = ROOT / "icon-192.png"
    out512 = ROOT / "icon-512.png"
    outico = ROOT / "favicon.ico"

    icon192.save(out192, "PNG", optimize=True)
    icon512.save(out512, "PNG", optimize=True)

    fav16 = fav32.resize((16, 16), Image.Resampling.LANCZOS)
    fav32.save(
        outico,
        format="ICO",
        sizes=[(32, 32), (16, 16)],
        append_images=[fav16],
    )

    logo_out = export_full_logo_png()

    print(f"Wrote {out192}, {out512}, {outico}")
    if logo_out:
        print(f"Wrote {logo_out} (full logo, left ~48% of composite)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
