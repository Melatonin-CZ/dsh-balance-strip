"""生成市场卡片图标 assets/icon-180.png（180×180）与 assets/icon-512.png。

图形语言与插件一致：胶囊条轮廓 + 绿→琥珀→红渐变描边 + 金币 ¥。
    python tools/make-icon.py
"""
import sys
from PIL import Image, ImageDraw


def lerp(a, b, t):
    return a + (b - a) * t


def scale_color(stops, t):
    """stops: [(pos, (r,g,b)), ...]，pos 从 0..1 递减对应 0%..100%。"""
    if t >= stops[0][0]:
        return stops[0][1]
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        if p0 >= t >= p1:
            k = (p0 - t) / (p0 - p1) if p0 != p1 else 0
            return tuple(int(round(lerp(c0[j], c1[j], k))) for j in range(3))
    return stops[-1][1] if t <= stops[-1][0] else stops[0][1]


STOPS = [(1.0, (0x3e, 0xc8, 0x73)), (0.5, (0xf4, 0xaf, 0x1f)), (0.0, (0xee, 0x34, 0x3b))]


def render(size=180, dark=True):
    S = 4
    n = size * S
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = int(n * 0.06)
    radius = int(n * 0.22)
    d.rounded_rectangle([pad, pad, n - pad - 1, n - pad - 1], radius=radius,
                        fill=(15, 17, 21, 255) if dark else (247, 248, 250, 255))

    # 条形：横向 100%→0% 的色带
    bar_pad = int(n * 0.11)
    bar_h = int(n * 0.26)
    top = int(n * 0.30) - bar_h // 2
    mask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle([bar_pad, top, n - bar_pad, top + bar_h], radius=bar_h // 2, fill=255)

    ramp = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ramp)
    x0, x1 = bar_pad, n - bar_pad
    for x in range(x0, x1):
        t = 1 - (x - x0) / max(1, (x1 - x0 - 1))
        color = scale_color(STOPS, t)
        rd.line([(x, top), (x, top + bar_h)], fill=color + (255,))
    # 顶部压暗，做出条体的内阴影质感
    shade = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for y in range(top, top + bar_h):
        k = (y - top) / max(1, bar_h - 1)
        alpha = int(round(255 * (0.34 - 0.28 * k)))
        sd.line([(x0, y), (x1, y)], fill=(0, 0, 0, alpha))
    ramp = Image.alpha_composite(ramp, shade)
    img.paste(ramp, (0, 0), mask)

    # 金币：压在色带右侧
    r = int(n * 0.13)
    cx, cy = int(n * 0.725), int(n * 0.685)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(15, 17, 21, 255))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(244, 175, 31, 255), width=max(2, int(n * 0.012)))
    stroke = max(2, int(n * 0.016))
    k = r / 8.0
    d.line([(cx - 4.6 * k, cy - 4.4 * k), (cx, cy - 0.2 * k)], fill=(244, 175, 31, 255), width=stroke)
    d.line([(cx, cy - 0.2 * k), (cx + 4.6 * k, cy - 4.4 * k)], fill=(244, 175, 31, 255), width=stroke)
    d.line([(cx, cy - 0.2 * k), (cx, cy + 4.2 * k)], fill=(244, 175, 31, 255), width=stroke)
    d.line([(cx - 3.4 * k, cy + 0.6 * k), (cx + 3.4 * k, cy + 0.6 * k)], fill=(244, 175, 31, 255), width=stroke)
    d.line([(cx - 3.4 * k, cy + 2.8 * k), (cx + 3.4 * k, cy + 2.8 * k)], fill=(244, 175, 31, 255), width=stroke)

    return img.resize((size, size), Image.LANCZOS)


def main():
    for size in (180, 512):
        out = f'assets/icon-{size}.png'
        render(size).save(out, 'PNG')
        print('wrote', out)


if __name__ == '__main__':
    sys.exit(main())
