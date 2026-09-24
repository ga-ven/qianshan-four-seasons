#!/usr/bin/env bash
# 定点观察：把镜头对准世界坐标 (x,y,scale)，冻结动态层后截一帧。
# 用法: bash tools/look.sh <x> <y> <scale> <out.png> [冻结秒] [额外JS]
# 前置: 项目根目录跑 `python -m http.server 8788 --bind 127.0.0.1`
#
# 为什么不用 shot.js 直接 focusOn：shot.js 截图前只固定等 1200ms，
# 而 focusOn 的动画在无头 Chrome（~9fps）下会拖到几秒 —— 会截到动画中间态。
# 这里改成「轮询动画位 + 轮询分片队列」，两样都排空了再冻表，帧才可信。
set -u
cd "$(dirname "$0")/.." || exit 1

# 工具链一律走环境变量，默认用 PATH 上的命令；
# 本机若要钉死某个解释器，跑之前 export NODE=/path/to/node 即可。
NODE="${NODE:-node}"
X=${1:?用法: look.sh <x> <y> <scale> <out.png> [冻结秒] [额外JS]}
Y=${2:?}
SC=${3:?}
OUT=${4:?}
T=${5:-1.0}
EXTRA=${6:-}

read -r -d '' SCRIPT <<JS
(function(){
  var kv=window.KV, e=kv.engine(), f=kv.fx();
  var I=document.getElementById('intro'); if(I){I.classList.add('gone'); I.style.display='none';}
  function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
  return (async function(){
    await sleep(1400);
    e.focusOn($X, $Y, $SC, 0);
    for (var i=0;i<220 && (e.scaleAnim||e.focusAnim);i++) await sleep(50);
    for (var i=0;i<220 && e.queue && e.queue.length;i++) await sleep(60);
    ${EXTRA}
    /* EXTRA 之后要留够时间：点「时雨」后 rainActive 是渐入的（~1s 才到 1），
       粒子也要几帧才补足；只等 500ms 会截到一场「才刚开始下」的雨。 */
    await sleep(1700);
    for (var i=0;i<220 && e.queue && e.queue.length;i++) await sleep(60);
    f.alive.t = $T; f.update=function(){}; f.draw(e);
    return {x:Math.round(e.view.x), y:Math.round(e.view.y), s:e.view.scale,
            visW:Math.round(e.visibleW()), tiles:e.stats.tiles,
            rainActive:Math.round(f.rainActive*100)/100, rainN:f.rain.length,
            q:f.alive.qUsed, walkers:f.alive.walkers};
  })();
})()
JS

"$NODE" tools/shot.js "${URL:-http://127.0.0.1:8788}/" "$OUT" 3400 "$SCRIPT" 1280 720
