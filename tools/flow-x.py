#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""flow-x.py —— 测**水平**位移：河在往哪边流、流多快。

为什么不能直接用 flow-check.py：
那个脚本是给瀑布写的，逐列做**纵向**互相关。河是横着流的，
纵向上永远报 0 —— 那不是「没动」，是**测错了轴**。
（本项目 2026-09 就在这里绕过一圈：明明水在动，却测出「静止」。）

做法：拿 isolate.js target=water 产出的四帧，先算出「水层」本身

    水层(t) = 含物体(t) − 屏蔽物体(t)

这样静态底纹（山、岸、树）被逐像素扣干净，只剩水纹。
再把水面横带**逐行平均**压成一条 x 剖面，对两个时刻的剖面做归一化互相关，
在 ±rmax 像素内找最佳位移。剖面比单行稳得多：一行的信号只有几十个像素，
一整带的行平均把信噪比拉高一个数量级。

用法:
  python tools/flow-x.py <prefix> <tA> <tB> <y0> <y1> [rmax] [scale]

  prefix 是 isolate.js 的输出前缀（会去读 <prefix>-Afull/-Aoff/-Bfull/-Boff.png）
  输出的 dx 是**屏幕像素**；除以 scale 得世界单位，再除以 Δt 得世界单位/秒。
"""
import sys
import numpy as np
from PIL import Image


def load_rgb(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.float32)


def layer(full_path, off_path):
    """水层的变化强度场：两帧相减后取绝对值之和。
    用 |diff| 而不是有符号差：水纹是「亮一笔 + 暗一笔」成对出现的，
    有符号差会让两者在行平均时互相抵消。"""
    d = load_rgb(full_path) - load_rgb(off_path)
    return np.abs(d).sum(axis=2)


def profile(field, y0, y1):
    """把横带压成一条 x 剖面，并去均值（互相关要求零均值）。"""
    p = field[y0:y1, :].mean(axis=0)
    return p - p.mean()


def best_shift(pa, pb, rmax):
    """pb 相对 pa 的位移（屏幕像素，+x 向右）。

    定义：取 d，让切片 pa[lo:hi] 与 pb[lo−d:hi−d]（lo=max(0,d), hi=min(n,n+d)）最像。
      d > 0 时比较的是 pa[d:n] 与 pb[0:n−d]：
        pa 的 d+i 号位置对应 pb 的 i 号位置 → 特征从 d+i 挪到了 i
        即向左移了 d  →  **位移 = −d**
    （这个符号极易写反，所以返回值取 −d，并用合成信号自测过。）
    """
    n = len(pa)
    best_d, best_c = 0, -2e9
    for d in range(-rmax, rmax + 1):
        lo = max(0, d)
        hi = min(n, n + d)
        if hi - lo < 300:
            continue
        x = pa[lo:hi]
        y = pb[lo - d:hi - d]
        x = x - x.mean()
        y = y - y.mean()
        den = np.sqrt((x * x).sum() * (y * y).sum())
        if den <= 0:
            continue
        c = float((x * y).sum() / den)
        if c > best_c:
            best_d, best_c = d, c
    return -best_d, best_c


def main():
    if len(sys.argv) < 6:
        print(__doc__)
        return 2
    prefix = sys.argv[1]
    tA = float(sys.argv[2])
    tB = float(sys.argv[3])
    y0 = int(sys.argv[4])
    y1 = int(sys.argv[5])
    rmax = int(sys.argv[6]) if len(sys.argv) > 6 else 90
    scale = float(sys.argv[7]) if len(sys.argv) > 7 else 0.8

    A = layer(prefix + '-Afull.png', prefix + '-Aoff.png')
    B = layer(prefix + '-Bfull.png', prefix + '-Boff.png')
    pa = profile(A, y0, y1)
    pb = profile(B, y0, y1)

    # 报告水层本身有多大能量，避免「两帧都是空的」也算出一个位移
    band_a = float(A[y0:y1, :].mean())
    band_b = float(B[y0:y1, :].mean())

    dx, c = best_shift(pa, pb, rmax)
    dbest = -dx                      # best_shift 内部的最优 d
    dt = tB - tA
    print('水层信号强度  A=%.2f  B=%.2f  （若两者都接近 0，说明隔离失败，结果无意义）'
          % (band_a, band_b))
    print('剖面长度 %d px，搜索范围 ±%d' % (len(pa), rmax))
    print('最佳位移 dx = %+d 屏幕px   （归一化相关 %.4f）' % (dx, c))
    print('Δt = %.2f s   速度 = %+.2f 屏幕px/秒  = %+.2f 世界单位/秒'
          % (dt, dx / dt, dx / dt / scale))

    # 亚像素：在峰值附近做抛物线拟合，把 dx 精化到 0.1px
    vals = {}
    for d in range(max(-rmax, dbest - 3), min(rmax, dbest + 3) + 1):
        lo = max(0, d); hi = min(len(pa), len(pa) + d)
        if hi - lo < 300:
            continue
        x = pa[lo:hi] - pa[lo:hi].mean()
        y = pb[lo - d:hi - d] - pb[lo - d:hi - d].mean()
        den = np.sqrt((x * x).sum() * (y * y).sum())
        if den > 0:
            vals[d] = float((x * y).sum() / den)
    if dbest - 1 in vals and dbest + 1 in vals and dbest in vals:
        y_1, y0v, y1v = vals[dbest - 1], vals[dbest], vals[dbest + 1]
        denom = (y_1 - 2 * y0v + y1v)
        if abs(denom) > 1e-12:
            sub_d = dbest + 0.5 * (y_1 - y1v) / denom
            sub = -sub_d
            print('亚像素精化 dx = %+.2f 屏幕px  →  %+.2f 世界单位/秒'
                  % (sub, sub / dt / scale))
    return 0


if __name__ == '__main__':
    sys.exit(main())
