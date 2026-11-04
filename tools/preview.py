"""渲染 dsh-balance-strip 的可视预览（不复刻浏览器，只做同色值/同渐变的近似 mock）。

用法：
    python tools/preview.py _probe/ramp-aurora.json docs/preview-aurora.png
"""
import json
import sys
from PIL import Image, ImageDraw, ImageFont

S = 3                      # 超采样倍数
BAR_W, BAR_H = 186, 18     # CSS 像素尺寸（与插件默认一致）
PAD = 28
FONT = r"C:\Windows\Fonts\msyh.ttc"


def sg(v):
    return int(round(v * S))


def hex_rgb(value):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def font(size):
    try:
        return ImageFont.truetype(FONT, sg(size))
    except OSError:
        return ImageFont.load_default()


def alpha_at(t, top, mid, bottom):
    """三段线性：0% → top，55% → mid，100% → bottom。"""
    if t <= 0.55:
        k = t / 0.55
        return top + (mid - top) * k
    k = (t - 0.55) / 0.45
    return mid + (bottom - mid) * k


def alpha_style(t, shade, vignette=False):
    top, mid, bottom = shade
    if not vignette:
        return alpha_at(t, top, mid, bottom)
    if t <= 0.46:
        a = top + (mid - top) * (t / 0.46)
    elif t <= 0.64:
        a = mid * (1 - (t - 0.46) / 0.18)
    else:
        a = 0.0
    if t >= 0.58:
        a = max(a, bottom * (1 - (1 - t) / 0.42))
    return a


def draw_pill(canvas, x, y, w, h, fill, ink, shade, text, radius=None, gloss=True, vignette=False, texture=None):
    top, mid, bottom = shade
    radius = h // 2 if radius is None else radius
    base = Image.new("RGB", (w, h), hex_rgb(fill))

    # 密集小方块纹理（棋盘格）：与 textureCss 的 squares 同参数
    if texture and texture.get("enabled", True) and texture.get("pattern", "squares") != "none":
        cell = max(1, int(texture.get("size", 4) * S / 2))
        alpha = int(round(texture.get("alpha", 0.14) * 255))
        tex = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        td = ImageDraw.Draw(tex)
        for gy in range(0, h, cell):
            for gx in range(0, w, cell):
                if ((gx // cell) + (gy // cell)) % 2 == 0:
                    td.rectangle([gx, gy, gx + cell - 1, gy + cell - 1], fill=(0, 0, 0, alpha))
        base = Image.alpha_composite(base.convert("RGBA"), tex).convert("RGB")

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for row in range(h):
        a = alpha_style(row / max(1, h - 1), shade, vignette)
        od.line([(0, row), (w, row)], fill=(0, 0, 0, int(round(a * 255))))

    if gloss:
        gh = max(1, int(h * 0.52))
        for row in range(gh):
            a = 0.16 * (1 - row / max(1, gh - 1))
            od.line([(0, row), (w, row)], fill=(255, 255, 255, int(round(a * 255))))

    base = Image.alpha_composite(base.convert("RGBA"), overlay)

    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    canvas.paste(base, (x, y), mask)

    d = ImageDraw.Draw(canvas, "RGBA")
    d.rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=radius, outline=(0, 0, 0, 40), width=max(1, S // 2))

    if text:
        f = font(11)
        tw = d.textlength(text, font=f)
        d.text((x + (w - tw) / 2, y + h / 2), text, font=f, fill=hex_rgb(ink), anchor="lm")


def draw_ramp(canvas, x, y, w, h, samples, shade, vignette=False):
    top, mid, bottom = shade
    for i, fill in enumerate(samples):
        seg = w / len(samples)
        px0 = x + i * seg
        base = Image.new("RGB", (max(1, int(seg) + 1), h), hex_rgb(fill))
        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        for row in range(h):
            a = alpha_style(row / max(1, h - 1), shade, vignette)
            od.line([(0, row), (base.size[0], row)], fill=(0, 0, 0, int(round(a * 255))))
        base = Image.alpha_composite(base.convert("RGBA"), overlay)
        canvas.paste(base, (int(px0), y))


def panel(rows, title, dark, samples, shade, vignette=False, texture=None):
    H = sg(PAD * 2 + 26 + len(rows) * 34 + 54)
    W = sg(PAD * 2 + BAR_W + 190)
    img = Image.new("RGB", (W, H), (15, 17, 21) if dark else (247, 248, 250))
    d = ImageDraw.Draw(img, "RGBA")
    ink = (232, 234, 237) if dark else (32, 34, 38)
    sub = (150, 156, 165) if dark else (110, 116, 124)

    d.text((sg(PAD), sg(PAD)), title, font=font(13), fill=ink)
    y = sg(PAD + 26)
    for row in rows:
        draw_pill(img, sg(PAD), y, sg(BAR_W), sg(BAR_H), row['fill'], row['ink'], shade, row['bar_text'], vignette=vignette, texture=texture)
        d.text((sg(PAD + BAR_W + 14), y + sg(BAR_H / 2)), f"{row['percent']}  {row['fill']}  {row['money']}  对比度 {row['contrast']}",
               font=font(10), fill=sub, anchor="lm")
        y += sg(34)

    d.text((sg(PAD), y + sg(6)), '连续色带 0 → 100%', font=font(10), fill=sub)
    draw_ramp(img, sg(PAD), y + sg(22), sg(BAR_W + 150), sg(14), samples, shade, vignette)
    return img


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else '_probe/ramp-aurora.json'
    out = sys.argv[2] if len(sys.argv) > 2 else 'docs/preview.png'
    data = json.load(open(src, encoding='utf-8'))
    cfg = data['config']
    shade = (cfg['overlay']['top'], cfg['overlay']['mid'], cfg['overlay']['bottom'])

    rows = []
    for row in data['rows']:
        text = f"余额 {row['money'].split(' ')[-1]} · {row['percent']}" if False else f"余额 {row['money']} · {row['percent']}"
        rows.append({**row, 'bar_text': text})

    samples = []
    # 用与实现相同的色阶函数生成 120 个采样点（由 emit-ramp 提供的端点做线性兜底时会有断层，
    # 所以这里交给调用方传入完整采样；缺省则用 5 档插值）
    if 'samples' in data:
        samples = data['samples']
    else:
        palette = data['rows']
        for i in range(120):
            f = 1 - i / 119
            lo = min(palette, key=lambda r: abs(r['fraction'] - f))
            samples.append(lo['fill'])

    style = sys.argv[3] if len(sys.argv) > 3 else "top-dark"
    texture = cfg.get("texture", {})
    dark = panel(rows, f"dsh-balance-strip · {data['palette']} · {style} · dark", True, samples, shade, style == "vignette", texture=texture)
    light = panel(rows, f"dsh-balance-strip · {data['palette']} · {style} · light", False, samples, shade, style == "vignette", texture=texture)

    gap = sg(10)
    W = max(dark.width, light.width)
    canvas = Image.new('RGB', (W, dark.height + light.height + gap), (120, 124, 130))
    canvas.paste(dark, (0, 0))
    canvas.paste(light, (0, dark.height + gap))
    canvas.save(out, 'PNG')
    print('wrote', out, canvas.size)


if __name__ == '__main__':
    main()
