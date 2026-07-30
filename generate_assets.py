"""
generate_assets.py
-------------------
Script de build avulso (não faz parte do app entregue) usado para gerar as
imagens do player de música "Sulco": ícones do app (normais + "maskable"),
uma textura semitransparente de disco de vinil, e uma capa de álbum padrão
elegante. Rode uma vez com `python3 generate_assets.py`; a saída vai para
assets/icons e assets/images dentro da pasta do projeto.
"""

import math
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = "/home/claude/sulco/assets"

# ---- Paleta da marca (mantida em sincronia com as variáveis CSS em style.css) ----
BG = (11, 11, 14)          # #0B0B0E fundo grafite
BG2 = (22, 21, 27)         # #16151B
COPPER = (227, 168, 87)    # #E3A857 cor de destaque principal
VIOLET = (124, 111, 203)   # #7C6FCB cor de destaque secundária
CREAM = (242, 240, 235)    # #F2F0EB texto principal


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def radial_gradient(size, c_in, c_out):
    img = Image.new("RGB", (size, size), c_out)
    px = img.load()
    cx = cy = size / 2
    maxd = math.hypot(cx, cy)
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cx, y - cy) / maxd
            px[x, y] = lerp(c_in, c_out, min(d, 1))
    return img


def draw_vinyl_disc(size, groove_count=46, label_ratio=0.34, alpha_disc=255):
    """Desenha um disco de vinil: disco preto, sulcos concêntricos, brilho e rótulo cobre/violeta."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = size / 2, size / 2
    r = size / 2 - 2

    # Disco base - quase preto com uma leve tonalidade quente, não #000 puro, para parecer um material real
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(18, 17, 20, alpha_disc))

    # Sulcos concêntricos: anéis alternando entre claro/escuro sutilmente
    for i in range(groove_count):
        gr = r * (1 - i / groove_count) * 0.94
        if gr < r * label_ratio:
            break
        shade = 30 + (i % 3) * 6
        draw.ellipse(
            [cx - gr, cy - gr, cx + gr, cy + gr],
            outline=(shade, shade, shade + 2, 120),
            width=1,
        )

    # Brilho radial suave (simula uma faixa de reflexo de luz)
    sheen = Image.new("L", (size, size), 0)
    sd = ImageDraw.Draw(sheen)
    sd.pieslice([cx - r, cy - r, cx + r, cy + r], 200, 260, fill=70)
    sheen = sheen.filter(ImageFilter.GaussianBlur(size * 0.05))
    glow = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    glow.putalpha(sheen)
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    # Rótulo (centro) com gradiente cobre -> violeta
    lr = r * label_ratio
    label = radial_gradient(int(lr * 2), COPPER, VIOLET).convert("RGBA")
    mask = Image.new("L", label.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, label.size[0], label.size[1]], fill=255)
    img.paste(label, (int(cx - lr), int(cy - lr)), mask)

    # Furo do eixo
    hr = r * 0.035
    draw.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=(8, 8, 9, 255))
    draw.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], outline=(0, 0, 0, 255), width=1)

    return img


def make_icon(size, maskable=False, path=None):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg = radial_gradient(size, BG2, BG).convert("RGBA")
    mask = Image.new("L", (size, size), 255)
    if not maskable:
        # rounded-square background for the "any" purpose icon
        mask = Image.new("L", (size, size), 0)
        rr = int(size * 0.22)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size, size], radius=rr, fill=255)
    img.paste(bg, (0, 0), mask)

    # Para ícones maskable, mantém o vinil dentro da zona segura (~80% central)
    disc_size = int(size * (0.62 if maskable else 0.74))
    disc = draw_vinyl_disc(disc_size, groove_count=10, label_ratio=0.38)
    img.alpha_composite(disc, ((size - disc_size) // 2, (size - disc_size) // 2))

    img.save(path)


def make_default_cover(path, size=800):
    img = radial_gradient(size, BG2, BG).convert("RGBA")
    draw = ImageDraw.Draw(img)
    cx, cy = size / 2, size / 2

    # Marca abstrata de "onda em sulco" - três arcos sugerindo som / um sulco de disco
    for i, r in enumerate([size * 0.30, size * 0.22, size * 0.14]):
        color = lerp(COPPER, VIOLET, i / 2)
        draw.arc(
            [cx - r, cy - r, cx + r, cy + r],
            start=200,
            end=340,
            fill=color + (255,) if len(color) == 3 else color,
            width=max(2, int(size * 0.012)),
        )

    dot_r = size * 0.045
    draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=COPPER + (255,))
    img = img.filter(ImageFilter.SMOOTH)
    img.save(path)


if __name__ == "__main__":
    import os

    os.makedirs(f"{OUT}/icons", exist_ok=True)
    os.makedirs(f"{OUT}/images", exist_ok=True)

    for size in [72, 96, 128, 144, 152, 180, 192, 384, 512]:
        make_icon(size, maskable=False, path=f"{OUT}/icons/icon-{size}.png")
    for size in [192, 512]:
        make_icon(size, maskable=True, path=f"{OUT}/icons/maskable-{size}.png")

    make_default_cover(f"{OUT}/images/default-cover.png", size=800)

    print("Assets generated.")
