from PIL import Image
from pathlib import Path

folder = Path("ios/AISmartCashBook/Images.xcassets/AppIcon.appiconset")

icons = [
    "icon_120.png",
    "icon_152.png",
    "icon_167.png",
    "icon_180.png",
    "icon_1024.png",
]

for name in icons:
    path = folder / name
    if not path.exists():
        print(f"Not found: {path}")
        continue

    img = Image.open(path).convert("RGBA")
    background = Image.new("RGBA", img.size, (255, 255, 255, 255))
    background.alpha_composite(img)

    background.convert("RGB").save(path, "PNG")

    print(f"Fixed: {path}")

print("Done.")