#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""两帧冻表对比：按屏幕高度带统计差异像素，定位「到底哪一带动了」。

配套 tools/pair.js 使用：pair.js 在同一页面会话里冻出两个时刻 tA / tB，
本脚本只回答一个问题 —— 这两帧之间「差在哪一带、差多少」。

为什么按高度带：长卷是横向的，画面自上而下是 山 → 山脚 → 河面 → 岸路 → 近岸。
用户点名要动的四样东西（瀑布/河水/荷花/小船）分属不同高度带，
分带统计才能证明「动的是我要它动的那一层」，而不是整幅画在闪。

用法:
  python tools/diff-bands.py A.png B.png [阈值]
依赖: numpy, pillow

注：Windows 上请用 Python 的绝对路径调用本脚本；
Git Bash 的 /tmp 对 Windows 版 Python 不可见（会解析成 D:\\tmp）。
"""
import sys

import numpy as np
from PIL import Image

BANDS = [
    ("山/远水上部",     0, 300),
    ("山脚/中景",     300, 430),
    ("河面",         430, 520),
    ("岸路/行人/树脚", 520, 650),
    ("近岸/底栏",     650, 10 ** 9),
]

# 按**世界坐标**分带（长卷真实布局，见 SceneData.LAYOUT）：
#   ridgeBase=582 山脚 / shore=632 岸线 / waterBottom=776 水底
# 按屏幕像素硬编码分带会随视距一起漂 —— 换一档缩放，「河面」那一带
# 就落到树上去了（本项目就被这个误导过一次：以为在量水面，其实在量树）。
WORLD_BANDS = [
    ("远山",        0, 380),
    ("山体",      380, 582),
    ("树线/岸路", 582, 636),
    ("河面",      636, 776),
    ("水外/近岸", 776, 10 ** 9),
]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    a = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.int16)
    b = np.asarray(Image.open(sys.argv[2]).convert("RGB")).astype(np.int16)
    if a.shape != b.shape:
        print("两帧尺寸不一致：%s vs %s" % (a.shape, b.shape))
        return 1
    thr = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    # 可选: --view <viewY> --scale <s>  → 按世界坐标分带
    view_y = scale = None
    if "--view" in sys.argv:
        view_y = float(sys.argv[sys.argv.index("--view") + 1])
    if "--scale" in sys.argv:
        scale = float(sys.argv[sys.argv.index("--scale") + 1])
    h, w = a.shape[:2]
    d = np.abs(a - b).max(axis=2)
    mask = d > thr

    print("图幅 %dx%d   阈值 >%d" % (w, h, thr))
    print("全图差异像素 %d (%.2f%%)   maxdiff %d"
          % (int(mask.sum()), 100.0 * mask.sum() / mask.size, int(d.max())))

    if view_y is not None and scale:
        # 世界带 → 屏幕带。屏幕 y = (世界 y − view.y) × scale
        print("（按世界坐标分带: view.y=%g  scale=%g）" % (view_y, scale))
        bands = []
        for name, wy0, wy1 in WORLD_BANDS:
            y0 = int(round((wy0 - view_y) * scale))
            y1 = int(round((wy1 - view_y) * scale))
            bands.append((name + " w%d~%s" % (wy0, "∞" if wy1 > 10 ** 8 else wy1), y0, y1))
    else:
        bands = BANDS

    for name, y0, y1 in bands:
        if y1 <= 0 or y0 >= h:
            print("  %-22s （不在视口内）" % name)
            continue
        y0 = max(0, y0)
        y1 = min(y1, h)
        sub = mask[y0:y1]
        n = int(sub.sum())
        print("  %-22s 屏幕y=%4d~%4d   差 %7d  (%5.2f%%)"
              % (name, y0, y1, n, 100.0 * n / sub.size))

    ys, xs = np.nonzero(mask)
    if len(xs):
        print("差异包围盒 x[%d~%d] y[%d~%d]   质心 (%.1f,%.1f)"
              % (xs.min(), xs.max(), ys.min(), ys.max(), xs.mean(), ys.mean()))
    else:
        print("两帧完全相同（此动画未生效）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
