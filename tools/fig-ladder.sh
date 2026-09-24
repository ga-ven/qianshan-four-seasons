# 视距梯子：把同一个人按 1×、2×、4× 视距并排画出来
# 判据是「在用户真正会看到的尺寸下能不能读出人形」，
# 而不是「放到 13 倍好不好看」——13 倍下笔宽会被放大成假象。
set -e
cd "$(dirname "$0")/.."
# 工具链一律走环境变量，默认用 PATH 上的命令。
NODE="${NODE:-node}"
# 分析像素的脚本要 Pillow（pip install pillow）；
# 装在不同解释器里时用 PY=<path> 覆盖。
PY="${PY:-python}"
KIND="${1:-bearer}"
for pair in "0.80 lad1" "1.60 lad2" "3.20 lad4"; do
  set -- $pair
  "$NODE" tools/fig-sheet.js ${URL:-http://127.0.0.1:8788}/ "shots/_diag/$2.png" "$1" "$KIND" >/dev/null
done
"$PY" - "$KIND" <<'EOF'
import sys
from PIL import Image, ImageDraw
kind = sys.argv[1]
band = (60, 118, 1280, 202)          # 第 0 行（基线 y=170）
labels = ['1x  (default 0.8) ', '2x  (1.6)        ', '4x  (3.2)        ']
ims = [Image.open('shots/_diag/lad%d.png' % n).crop(band) for n in (1, 2, 4)]
SC = 3                                # 再整体放大 3 倍便于观察
out = Image.new('RGB', (band[2]-band[0], ((band[3]-band[1])*SC + 16) * 3), (250, 248, 242))
d = ImageDraw.Draw(out)
y = 0
for lab, im in zip(labels, ims):
    im = im.resize((im.width*SC, im.height*SC), Image.NEAREST)
    out.paste(im, (0, y))
    d.text((6, y+4), lab, fill=(200, 30, 30))
    y += im.height + 16
out.save('shots/_diag/ladder-%s.png' % kind)
print('saved shots/_diag/ladder-%s.png' % kind, out.size)
EOF
