#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""flow-check.py —— 测「纹理的整体位移方向」，回答「到底在往哪动」。

anim-proof 只能说明「某处像素在变」，说明不了「往哪个方向变」。
而「瀑布在落」和「瀑布在闪」的差别，恰恰就是这个方向。

做法：取两帧之间隔了一个小 Δt 的图，在给定矩形内**逐列**做纵向互相关，
找每列的灰度最佳匹配位移，取中位数。
  dy > 0 → 纹理整体向下（下落）
  dy < 0 → 向上
  dy ≈ 0 → 原地明灭，没有位移

两种输入模式：

  1) 两图模式（默认）—— 直接比两帧，适合高对比、无静态底纹的场景。
     python tools/flow-check.py A.png B.png x0 y0 x1 y1 [r]

  2) 隔离模式（--iso）—— 配 isolate.js 的四帧，见下。
     python tools/flow-check.py Afull Aoff Bfull Boff x0 y0 x1 y1 [r] [--neg]

     **瀑布这种「静态叠层 + 动态水痕」必须先隔离**。静态叠层在两帧里逐像素
     相同，互相关会被它死死锁在 dy=0，水痕的位移峰完全冒不出来
     （实测 84 列全部报 0，看着像「没在动」，其实是静态部分太强）。
     用 A_full − A_off 得到「瀑布引入的变化」：
        亮水痕 / 白色叠层 → 正值
        暗痕              → 负值
     取 --neg 就只剩**暗痕**，静态叠层被扣掉。暗痕同样是下落的水，照测不误。

关键细节：**不能用一阶差分**（np.diff）做高通。水痕是 createLinearGradient
画的「0→亮→0」平缓鼓包，不是锐利边缘，差分后幅值几乎为 0。改用「减去大尺度
移动平均」。

**已知局限（重要）**：对「稀疏细线」类纹理 —— 比如瀑布那 24 条水痕，整幅的有效
信号可能只有几百像素 —— 逐列互相关**定位不出位移**：每列上的有效信号太少，
相关面上根本没有可辨的峰（实测隔离出暗痕后仍然 84 列全报 0）。

这类情形别在像素上继续猜，改成**在页面里复现渲染所用的位移公式**去核对方向与步长：
照抄绘制代码里的同一份幻数与哈希函数，取两个时刻各算一遍位置即可
（本项目靠这个拿到结论：Δt=0.05s 内 24 条水痕**全部**下移、平均 11.2 屏幕px，
而横向质心只动 0.05px —— 竖直下落、不横摆）。

用法见上。依赖: numpy, pillow
"""
import sys

import numpy as np
from PIL import Image


def load(p):
    return np.asarray(Image.open(p).convert("L")).astype(np.float32)


def highpass(col, w=61):
    """减去大尺度移动平均，只留 ~w 像素尺度以下的起伏（水痕的长度量级）。"""
    n = len(col)
    if n < 5:
        return col - col.mean()
    w = min(w, n | 1)
    k = np.ones(w) / w
    return col - np.convolve(col, k, mode="same")


def col_best_shift(a, b, r):
    """一列的纵向最佳位移。返回 (误差, dy)。dy>0 表示纹理向下走了 dy 像素。"""
    da, db = highpass(a), highpass(b)
    n = len(da)
    best = (1e18, 0)
    for dy in range(-r, r + 1):
        if dy >= 0:
            x, y = da[:n - dy], db[dy:]
        else:
            x, y = da[-dy:], db[:n + dy]
        if len(x) < 40:
            continue
        d = float(np.abs(x - y).mean())
        if d < best[0]:
            best = (d, dy)
    return best


def main():
    flags = [a for a in sys.argv[1:] if a.startswith("--")]
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args or len(args) < 5:
        print(__doc__)
        return 2

    if "--iso" in flags:
        if len(args) < 8:
            print(__doc__)
            return 2
        Af, Ao, Bf, Bo = (load(args[i]) for i in range(4))
        x0, y0, x1, y1 = (int(v) for v in args[4:8])
        r = int(args[8]) if len(args) > 8 else 24
        A, B = Af - Ao, Bf - Bo
        tag = "隔离模式"
        if "--neg" in flags:
            A, B = np.clip(-A, 0, None), np.clip(-B, 0, None)
            tag += "（只取暗部＝暗痕）"
        else:
            tag += "（取全部变化）"
    else:
        if len(args) < 6:
            print(__doc__)
            return 2
        A, B = load(args[0]), load(args[1])
        x0, y0, x1, y1 = (int(v) for v in args[2:6])
        r = int(args[6]) if len(args) > 6 else 24
        tag = "两图模式"

    print("%s  区域 x[%d~%d] y[%d~%d]  搜索半径 ±%d" % (tag, x0, x1, y0, y1, r))

    # 预检：这个矩形里到底有没有东西可测
    sig = np.abs(A[y0:y1, x0:x1])
    if "--iso" in flags:
        print("预检: 信号非零像素 %d (%.2f%%)  峰值 %.0f"
              % (int((sig > 3).sum()), 100.0 * (sig > 3).mean(), sig.max()))
    else:
        dmap = np.abs(A[y0:y1, x0:x1] - B[y0:y1, x0:x1])
        print("预检: 两帧差异像素 %d (%.2f%%)  maxdiff %d"
              % (int((dmap > 3).sum()), 100.0 * (dmap > 3).mean(), dmap.max()))

    shifts = []
    for x in range(x0, x1):
        a, b = A[y0:y1, x], B[y0:y1, x]
        if a.std() < 0.8 and b.std() < 0.8:
            continue
        _, dy = col_best_shift(a, b, r)
        shifts.append(dy)
    if not shifts:
        print("矩形内没有可用的列（全空白？）")
        return 1

    shifts = np.array(shifts)
    med, mean = float(np.median(shifts)), float(shifts.mean())
    pos, neg, zero = int((shifts > 1).sum()), int((shifts < -1).sum()), int((np.abs(shifts) <= 1).sum())
    print("有效列 %d   位移 中位 %+.1fpx  均值 %+.1fpx" % (len(shifts), med, mean))
    print("  下移 %d 列 / 上移 %d 列 / 不动 %d 列   p25=%+.0f p75=%+.0f"
          % (pos, neg, zero, np.percentile(shifts, 25), np.percentile(shifts, 75)))
    if med > 1:
        print("✓ 纹理整体**向下**移动 → 水在落")
    elif med < -1:
        print("✓ 纹理整体**向上**移动")
    else:
        print("△ 纹理几乎无纵向位移 → 更像原地明灭，而不是水在落")
    return 0


if __name__ == "__main__":
    sys.exit(main())
