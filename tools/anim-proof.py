#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""anim-proof.py —— 读 isolate.js 产出的四帧，给出「该物体确实在动」的定量结论。

对照关系（同视角、同背景，只有 t 与「是否包含该物体」两个变量）：

    A_full = 背景(tA) + 物体(tA)      A_off = 背景(tA)
    B_full = 背景(tB) + 物体(tB)      B_off = 背景(tB)

推导出三件事：
  ① 物体占据的像素/屏幕 bbox ← diff(A_full, A_off)
     （位置不靠肉眼猜；也顺带证明它真的被画出来了，不是空图）
  ② 该区域内 背景自身 的变化 ← diff(A_off, B_off)
  ③ 该区域内 全部 的变化     ← diff(A_full, B_full)
    ③ 显著大于 ② 的部分就是**物体自身**在动。

用法:
  python tools/anim-proof.py <prefix> [阈值]
  （prefix 即 isolate.js 的 outPrefix，如 shots/_diag/iso-wf）
依赖: numpy, pillow
"""
import sys

import numpy as np
from PIL import Image


def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.int16)


def diffmask(a, b, thr):
    return np.abs(a - b).max(axis=2) > thr


def region_stats(mask, x0, y0, x1, y1):
    sub = mask[y0:y1, x0:x1]
    return int(sub.sum()), sub.size

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    pre = sys.argv[1]
    thr = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    Af, Ao = load(pre + "-Afull.png"), load(pre + "-Aoff.png")
    Bf, Bo = load(pre + "-Bfull.png"), load(pre + "-Boff.png")
    h, w = Af.shape[:2]

    # ① 物体占据的像素 → bbox
    obj = diffmask(Af, Ao, thr)
    n_obj = int(obj.sum())
    print("阈值 >%d   图幅 %dx%d" % (thr, w, h))
    print("① 物体像素 %d (%.2f%%)" % (n_obj, 100.0 * n_obj / obj.size))
    if n_obj == 0:
        print("   ✗ 屏蔽前后完全一致 —— 该物体根本没被画出来，或 target 名字写错")
        return 1
    ys, xs = np.nonzero(obj)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    print("   屏幕 bbox x[%d~%d] y[%d~%d]  质心 (%.1f,%.1f)"
          % (x0, x1, y0, y1, xs.mean(), ys.mean()))

    # ④ 横向位移：这是**方向性**证据，不是「越小越好」。
    #    竖直下落的东西（瀑布）横向必须钉住；水平流动的东西（河水）横向必须明显移动。
    #    早先把 ④ 一律当成「漂移就报错」，结果把「河水在流」判成了故障 —— 判据
    #    得跟着物体该走的方向走，所以由调用者用 --expect 声明。
    expect = None
    if "--expect" in sys.argv:
        expect = sys.argv[sys.argv.index("--expect") + 1]
    obj2 = diffmask(Bf, Bo, thr)
    if obj2.any():
        ys2, xs2 = np.nonzero(obj2)
        dx = xs2.mean() - xs.mean()
        print("④ 横向位移 x质心 A:%.1f → B:%.1f  Δ%+.2f px" % (xs.mean(), xs2.mean(), dx))
        print("   x 范围 A[%d~%d] B[%d~%d]  宽 %d / %d"
              % (xs.min(), xs.max(), xs2.min(), xs2.max(), xs.max() - xs.min(), xs2.max() - xs2.min()))
        if expect == "vertical":
            print("   ✓ 横向钉住，竖直运动" if abs(dx) < 1.5
                  else "   ✗ 竖直的物体却整体横移 %.1fpx —— 查是否被加了风剪切之类的横向力" % dx)
        elif expect == "horizontal":
            print("   ✓ 横向流动（这是流水该有的方向）" if abs(dx) > 4
                  else "   ✗ 期望横向流动，却几乎不动（%.1fpx）" % dx)
        else:
            print("   （中性：仅报数值；用 --expect vertical|horizontal 声明预期方向）")

    # 同一时刻两帧应当完全重合 → 顺带校验「位置由 t 唯一确定、无状态残留」
    det = diffmask(Af, Ao, 10 ** 9).sum()
    print("   [自校验] A_full 与 A_off 在极端阈值下的残余差异 %d" % det)

    # ②③ 在**物体自身的像素**上分离「背景变化」与「物体变化」。
    # 用 obj 掩码而不是 bbox：物体形状不规则，bbox 里大半是背景，
    # 拿 bbox 统计会把背景变化摊薄，反而显得物体没动。
    m_all = diffmask(Af, Bf, thr)
    m_bg = diffmask(Ao, Bo, thr)
    area = n_obj
    n_all = int(m_all[obj].sum())
    n_bg = int(m_bg[obj].sum())
    print("② 物体像素上 背景自身变化 %d (%.1f%%)" % (n_bg, 100.0 * n_bg / area))
    print("③ 物体像素上 全部变化     %d (%.1f%%)" % (n_all, 100.0 * n_all / area))
    extra = n_all - n_bg
    print("   ⇒ 归因于物体自身的变化 %d (%.1f%%)" % (extra, 100.0 * extra / area))
    if extra > max(60, 0.02 * area):
        print("   ✓ 该物体确实在动（自身贡献显著高于背景）")
    else:
        print("   ✗ 该物体区域的变化基本来自背景 —— 它自身几乎没动")
    return 0


if __name__ == "__main__":
    sys.exit(main())
