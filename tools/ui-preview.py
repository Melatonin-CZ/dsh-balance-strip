"""渲染 UI 预览：dock 行里的条形与金币入口 + 设置面板（浅色/深色）+ 图标尺寸。

数值与颜色都取自实现本身（core.cjs），不是另画一套：
    python tools/ui-preview.py docs/ui-preview.png
"""
import json
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

S = 2  # 超采样
FONT = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"


def sg(v):
    return int(round(v * S))


def font(size, bold=False):
    for path in ([FONT_BOLD] if bold else []) + [FONT]:
        try:
            return ImageFont.truetype(path, sg(size))
        except OSError:
            continue
    return ImageFont.load_default()


def hex_rgb(value):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def alpha_at(t, shade, vignette=False):
    top, mid, bottom = shade
    if not vignette:
        if t <= 0.55:
            return top + (mid - top) * (t / 0.55)
        return mid + (bottom - mid) * ((t - 0.55) / 0.45)
    if t <= 0.46:
        a = top + (mid - top) * (t / 0.46)
    elif t <= 0.64:
        a = mid * (1 - (t - 0.46) / 0.18)
    else:
        a = 0.0
    if t >= 0.58:
        a = max(a, bottom * (1 - (1 - t) / 0.42))
    return a


def draw_coin(canvas, x, y, size, color):
    """与 assets/coin.svg 同几何：外环 + ¥。"""
    x, y, size = int(x), int(y), int(size)
    d = ImageDraw.Draw(canvas, 'RGBA')
    r = size / 2
    cx, cy = x + r, y + r
    rw = max(1, int(round(size * 0.075)))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(color[0], color[1], color[2], 36))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(color[0], color[1], color[2], 216), width=rw)
    k = size / 16.0
    stroke = max(1, int(round(1.3 * k)))
    d.line([(x + 4.6 * k, y + 4.4 * k), (x + 8 * k, y + 8.2 * k)], fill=color, width=stroke)
    d.line([(x + 8 * k, y + 8.2 * k), (x + 11.4 * k, y + 4.4 * k)], fill=color, width=stroke)
    d.line([(x + 8 * k, y + 8.2 * k), (x + 8 * k, y + 11.8 * k)], fill=color, width=stroke)
    d.line([(x + 5.4 * k, y + 8.6 * k), (x + 10.6 * k, y + 8.6 * k)], fill=color, width=stroke)
    d.line([(x + 5.4 * k, y + 10.6 * k), (x + 10.6 * k, y + 10.6 * k)], fill=color, width=stroke)


def draw_bar(canvas, x, y, w, h, fill, ink, shade, text, texture, vignette=False):
    x, y, w, h = int(x), int(y), int(w), int(h)
    radius = h // 2
    base = Image.new('RGB', (w, h), hex_rgb(fill))
    if texture and texture.get('enabled', True) and texture.get('pattern', 'squares') != 'none':
        cell = max(1, int(texture.get('size', 4) * S / 2))
        alpha = int(round(texture.get('alpha', 0.14) * 255))
        tex = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        td = ImageDraw.Draw(tex)
        for gy in range(0, h, cell):
            for gx in range(0, w, cell):
                if ((gx // cell) + (gy // cell)) % 2 == 0:
                    td.rectangle([gx, gy, gx + cell - 1, gy + cell - 1], fill=(0, 0, 0, alpha))
        base = Image.alpha_composite(base.convert('RGBA'), tex).convert('RGB')

    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for row in range(h):
        a = alpha_at(row / max(1, h - 1), shade, vignette)
        od.line([(0, row), (w, row)], fill=(0, 0, 0, int(round(a * 255))))
    gh = max(1, int(h * 0.52))
    for row in range(gh):
        a = 0.16 * (1 - row / max(1, gh - 1))
        od.line([(0, row), (w, row)], fill=(255, 255, 255, int(round(a * 255))))
    base = Image.alpha_composite(base.convert('RGBA'), overlay)

    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    canvas.paste(base, (x, y), mask)
    d = ImageDraw.Draw(canvas, 'RGBA')
    d.rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=radius, outline=(0, 0, 0, 34), width=max(1, S // 2))
    if text:
        f = font(11)
        tw = d.textlength(text, font=f)
        d.text((x + (w - tw) / 2, y + h / 2), text, font=f, fill=hex_rgb(ink), anchor='lm')


def chip(d, x, y, text, sub=False, color=(110, 116, 124)):
    f = font(10)
    d.text((x, y), text, font=f, fill=color, anchor='lm')
    return d.textlength(text, font=f)


def ring(d, x, y, size, color, ratio):
    x, y, size = int(x), int(y), int(size)
    w = max(1, int(round(size * 0.16)))
    d.arc([x, y, x + size, y + size], 0, 360, fill=color, width=w)
    d.arc([x, y, x + size, y + size], -90, -90 + 360 * ratio, fill=color, width=w)


def dock_row(width, cfg, fill, ink, text, dark=False):
    bg = (255, 255, 255) if not dark else (24, 27, 32)
    fg = (110, 116, 124) if not dark else (150, 156, 165)
    h = sg(40)
    img = Image.new('RGB', (sg(width), h), bg)
    d = ImageDraw.Draw(img, 'RGBA')
    y = h // 2
    x = sg(26)
    x += chip(d, x, y, '6 轮 242 步 · 225 tok/s', color=fg) + sg(18)
    x += chip(d, x, y, '67.7M tok · 缓存命中中 99%', color=fg) + sg(18)

    bar_w, bar_h = sg(132), sg(cfg['height'])
    draw_bar(img, x, y - bar_h // 2, bar_w, bar_h, fill, ink, (cfg['overlay']['top'], cfg['overlay']['mid'], cfg['overlay']['bottom']), text, cfg.get('texture', {}), cfg['overlay'].get('direction') == 'vignette')
    x += bar_w + sg(6)
    coin_color = hex_rgb('#3b4148') if not dark else hex_rgb('#c9ced6')
    draw_coin(img, x, y - sg(7), sg(14), coin_color)
    x += sg(14) + sg(18)
    ring(d, x, y - sg(7), sg(14), fg, 0.35)
    x += sg(14) + sg(6)
    chip(d, x, y, '35%', color=fg)
    return img


def slider(d, x, y, w, ratio, color=(65, 118, 230)):
    x, y, w = int(x), int(y), int(w)
    track = (127, 127, 127, 60)
    d.rounded_rectangle([x, y - sg(1), x + w, y + sg(1)], radius=sg(1), fill=track)
    d.rounded_rectangle([x, y - sg(1), x + w * ratio, y + sg(1)], radius=sg(1), fill=color + (255,))
    d.ellipse([x + w * ratio - sg(3), y - sg(3), x + w * ratio + sg(3), y + sg(3)], fill=(255, 255, 255, 255), outline=color + (255,), width=1)


def field(d, x, y, w, h, text, dark):
    x, y, w, h = int(x), int(y), int(w), int(h)
    bg = (127, 127, 127, 26) if not dark else (255, 255, 255, 20)
    br = (127, 127, 127, 70)
    d.rounded_rectangle([x, y, x + w, y + h], radius=sg(4), fill=bg, outline=br, width=1)
    d.text((x + sg(5), y + h / 2), text, font=font(10), fill=(60, 64, 70) if not dark else (210, 214, 220), anchor='lm')


def checkbox(d, x, y, checked, dark):
    x, y = int(x), int(y)
    bg = (65, 118, 230, 255) if checked else ((127, 127, 127, 26) if not dark else (255, 255, 255, 20))
    d.rounded_rectangle([x, y, x + sg(11), y + sg(11)], radius=sg(3), fill=bg, outline=(127, 127, 127, 80), width=1)
    if checked:
        d.line([(x + sg(2.5), y + sg(6)), (x + sg(5), y + sg(8.5))], fill=(255, 255, 255, 255), width=max(1, S))
        d.line([(x + sg(5), y + sg(8.5)), (x + sg(9), y + sg(3))], fill=(255, 255, 255, 255), width=max(1, S))


def settings_panel(cfg, dark=False):
    W, H = sg(296), sg(470)
    bg = (247, 248, 250) if not dark else (28, 32, 39)
    fg = (32, 34, 38) if not dark else (232, 234, 237)
    sub = (110, 116, 124) if not dark else (150, 156, 165)
    img = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(img, 'RGBA')
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=sg(12), fill=bg, outline=(127, 127, 127, 60), width=1)

    pad = sg(12)
    draw_coin(img, pad, sg(8), sg(16), hex_rgb('#f4af1f'))
    d.text((pad + sg(22), sg(16)), '余额状态栏设置', font=font(12, True), fill=fg, anchor='lm')
    field(d, W - pad - sg(38), sg(10), sg(38), sg(16), '关闭', dark)

    y = sg(38)
    rows = [
        ('100% = 金额', 'field', '200', '默认'),
        ('动态变色', 'check', True, ''),
        ('配色预设', 'select', 'aurora 绿→琥珀→红', ''),
        ('满格颜色', 'color', '#22c55e', '#22c55e'),
        ('见底颜色', 'color', '#e5484d', '#e5484d'),
        ('纹理', 'check', False, ''),
        ('纹理样式', 'select', '密集小方块', ''),
        ('方块大小', 'range', 0.18, '4'),
        ('纹理浓度', 'range', 0.23, '0.14'),
        ('叠加方向', 'select', '自上而下压暗', ''),
        ('顶部黑度', 'range', 0.42, '0.34'),
        ('中部黑度', 'range', 0.22, '0.18'),
        ('底部黑度', 'range', 0.08, '0.06'),
        ('整条不透明度', 'range', 0.92, '0.94'),
        ('条高', 'range', 0.3, '18'),
        ('形态', 'select', '胶囊 pill', ''),
        ('刷新间隔', 'select', '30 秒', ''),
    ]
    for label, kind, value, trailing in rows:
        d.text((pad, y + sg(8)), label, font=font(10), fill=sub, anchor='lm')
        cx, cw = pad + sg(82), W - pad * 2 - sg(82) - sg(38)
        if kind == 'field':
            field(d, cx, y, cw - sg(4), sg(16), str(value), dark)
        elif kind == 'check':
            checkbox(d, cx, y + sg(3), value, dark)
        elif kind == 'select':
            field(d, cx, y, cw, sg(16), str(value), dark)
            d.polygon([(cx + cw - sg(10), y + sg(7)), (cx + cw - sg(4), y + sg(7)), (cx + cw - sg(7), y + sg(11))], fill=sub)
        elif kind == 'color':
            d.rounded_rectangle([cx, y + sg(1), cx + sg(28), y + sg(14)], radius=sg(4), fill=hex_rgb(value), outline=(127, 127, 127, 80), width=1)
        elif kind == 'range':
            slider(d, cx, y + sg(8), cw, float(value))
        if trailing:
            d.text((W - pad, y + sg(8)), str(trailing), font=font(10), fill=sub, anchor='rm')
        y += sg(22)

    hy = y + sg(6)
    d.text((pad, hy), '改动即时生效，保存在本浏览器（localStorage）；', font=font(9), fill=sub)
    d.text((pad, hy + sg(12)), 'cordis.patch.yml 仍是基线。', font=font(9), fill=sub)
    by = hy + sg(26)
    field(d, W - pad - sg(120), by, sg(52), sg(18), '恢复默认', dark)
    d.rounded_rectangle([W - pad - sg(62), by, W - pad, by + sg(18)], radius=sg(6), fill=(65, 118, 230, 255))
    d.text((W - pad - sg(31), by + sg(9)), '完成', font=font(10), fill=(255, 255, 255), anchor='mm')
    return img


def icons_strip(dark=False):
    bg = (247, 248, 250) if not dark else (24, 27, 32)
    img = Image.new('RGB', (sg(296), sg(56)), bg)
    d = ImageDraw.Draw(img, 'RGBA')
    color = hex_rgb('#3b4148') if not dark else hex_rgb('#c9ced6')
    x = sg(16)
    for size in (14, 18, 24, 32):
        draw_coin(img, x, sg(20) - sg(size) / 2 + sg(8), sg(size), color)
        d.text((x, sg(44)), f'{size}px', font=font(9), fill=(120, 126, 134))
        x += sg(size) + sg(26)
    return img


def load_config():
    """优先读 emit-ramp 产出的 JSON；没有就用与 core.cjs 一致的内置默认值。"""
    for candidate in ('../_probe/ramp-aurora.json', 'docs/ramp-aurora.json'):
        try:
            with open(candidate, encoding='utf-8') as handle:
                data = json.load(handle)
            if isinstance(data, dict) and 'config' in data:
                return data
        except OSError:
            continue
    return {'config': {
        'anchor': 100, 'anchorSet': False, 'dynamic': True, 'palette': 'aurora',
        'colorHigh': '#22c55e', 'colorLow': '#e5484d', 'height': 18, 'opacity': 0.94,
        'overlay': {'enabled': True, 'direction': 'top-dark', 'top': 0.34, 'mid': 0.18, 'bottom': 0.06},
        'texture': {'enabled': True, 'pattern': 'squares', 'size': 4, 'alpha': 0.14},
    }}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'docs/ui-preview.png'
    cfg = load_config()['config']

    fill, ink = '#3fc973', '#000000'
    bars = []
    for ratio, text in ((0.955, '余额 ¥95.48 95.5%'),):
        bars.append((ratio, text))

    cfg_on = dict(cfg)
    cfg_on['texture'] = dict(cfg.get('texture', {}))
    cfg_on['texture']['enabled'] = True
    rows = []
    rows.append(dock_row(620, cfg, '#3ec873', '#000000', '余额 ¥95.48 95.5%', dark=False))
    rows.append(dock_row(620, cfg_on, '#3ec873', '#000000', '余额 ¥95.48 95.5%（开纹理）', dark=False))
    row_h = rows[0].height

    panels = [settings_panel(cfg, False), settings_panel(cfg, True)]
    icons = [icons_strip(False), icons_strip(True)]

    width = max(panels[0].width * 2 + sg(16), rows[0].width) + sg(24)
    height = sg(24) + row_h * 2 + sg(24) + panels[0].height + icons[0].height + sg(28)
    canvas = Image.new('RGB', (width, height), (238, 239, 242))
    d = ImageDraw.Draw(canvas)

    y = sg(16)
    d.text((sg(12), y), 'dock 行（默认无纹理 / 开启纹理）', font=font(10), fill=(80, 84, 90))
    y += sg(14)
    for row in rows:
        canvas.paste(row, (sg(12), y))
        y += row_h + sg(6)

    y += sg(10)
    d.text((sg(12), y), '设置面板（左：浅色 / 右：深色）', font=font(10), fill=(80, 84, 90))
    y += sg(14)
    canvas.paste(panels[0], (sg(12), y))
    canvas.paste(panels[1], (sg(12) + panels[0].width + sg(16), y))
    y += panels[0].height + sg(14)

    d.text((sg(12), y), '金币图标（14 / 18 / 24 / 32 px）', font=font(10), fill=(80, 84, 90))
    y += sg(14)
    canvas.paste(icons[0], (sg(12), y))
    canvas.paste(icons[1], (sg(12) + icons[0].width + sg(16), y))

    canvas.save(out, 'PNG')
    print('wrote', out, canvas.size)


if __name__ == '__main__':
    main()
