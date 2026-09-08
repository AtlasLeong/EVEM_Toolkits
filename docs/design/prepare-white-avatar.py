"""Extract the approved white emblem from its generated gray checkerboard.

Usage: python prepare-white-avatar.py SOURCE.png OUTPUT.png
Requires Pillow. This threshold is specific to the approved first generation,
whose backdrop is below 220 and whose white artwork is above 250.
"""

import sys
from PIL import Image

source = Image.open(sys.argv[1]).convert("L")
alpha = source.point(lambda value: round(max(0, min(1, (value - 220) / 30)) * 255))
bounds = alpha.getbbox()
if not bounds:
    raise ValueError("No white artwork found")
alpha = alpha.crop(bounds)
alpha.thumbnail((232, 232), Image.Resampling.LANCZOS)
canvas = Image.new("L", (256, 256), 0)
canvas.paste(alpha, ((256 - alpha.width) // 2, (256 - alpha.height) // 2))
output = Image.new("RGBA", canvas.size, (255, 255, 255, 0))
output.putalpha(canvas)
output.save(sys.argv[2], optimize=True)
print(f"Saved {sys.argv[2]}: {output.size}, {output.mode}, alpha {canvas.getextrema()}")
