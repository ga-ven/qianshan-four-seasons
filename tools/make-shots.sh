#!/usr/bin/env bash
# 批量生成 shots/ 下的十张展示图。
# 用法: bash tools/make-shots.sh
# 前置: 在项目根目录跑 `python -m http.server 8788 --bind 127.0.0.1`
#
# 注意：镜头动画（focusOn/goTo）的时长参数单位是**秒**，而且无头 Chrome 里
# 一帧的 dt 被夹在 60ms，所以实际耗时比 dur 长。早期版本靠 shot.js 固定的
# 1200ms 等待来「等动画跑完」，结果在概览这种长动画上截到了动画中间态——
# 画卷贴在顶边、下面一大片空白，看起来像 bug。这里改成**轮询动画是否结束**。
set -u
cd "$(dirname "$0")/.." || exit 1

# 工具链一律走环境变量，默认用 PATH 上的命令；
# 本机若要钉死某个解释器，跑之前 export NODE=/path/to/node 即可。
NODE="${NODE:-node}"
URL="${URL:-http://127.0.0.1:8788}/"
OUT="shots"

# 开场遮罩收起 + 执行动作 + 等镜头动画落定（返回 Promise，shot.js 会 await）
SETTLE='return new Promise(function(res){var n=0;var iv=setInterval(function(){var e=KV.engine();if((!e.focusAnim&&!e.scaleAnim)||++n>90){clearInterval(iv);res("settled")}},80)});'
PRE="var I=document.getElementById('intro'); I.classList.add('gone'); I.style.display='none';"

shoot () {                       # $1 文件名  $2 动作代码  $3 宽  $4 高
  echo "── $1"
  "$NODE" tools/shot.js "$URL" "$OUT/$1" 3000 \
    "(function(){${PRE} $2 ${SETTLE}})()" "${3:-1280}" "${4:-720}" \
    | grep -E "已保存|页面错误|✗|EVAL" || true
}

# 01 开场：保留遮罩，让「展卷」露在画面里
echo "── 01-cover.png"
"$NODE" tools/shot.js "$URL" "$OUT/01-cover.png" 3000 "" 1280 720 \
  | grep -E "已保存|页面错误|✗" || true

# 02~05 四季：同一视距，沿卷轴推进
# 春这一张单独把镜头压低（y 470→560）对准桃花源村：
# 压 470 时岸线落在底栏后面，茅舍、井、桑都只露个顶；
# 村舍是这张图的主角（「屋舍俨然，鸡犬相闻」），必须整座在框内。
shoot "02-spring.png" "KV.engine().focusOn(2250, 560, 0.95, 0.4);"
shoot "03-summer.png" "KV.engine().focusOn(4100, 470, 0.95, 0.4);"
shoot "04-autumn.png" "KV.engine().focusOn(7500, 470, 0.95, 0.4);"
shoot "05-winter.png" "KV.engine().focusOn(10800, 470, 0.95, 0.4);"

# 06 近景：飞瀑（全幅最考笔法的一处）
shoot "06-closeup.png" "KV.engine().focusOn(3934, 470, 2.4, 0.4);"

# 07 整卷概览：走 preview 带那条路径
shoot "07-overview.png" "document.getElementById('btn-overview').click();"

# 08 时雨
shoot "08-rain.png" "KV.engine().focusOn(5200, 470, 0.95, 0.4); document.getElementById('btn-rain').click();"

# 09 题跋卡片（夏：水光潋滟晴方好 / 山色空蒙雨亦奇）
shoot "09-card.png" "KV.engine().focusOn(4380, 430, 0.95, 0.4); UI.selectInscription(2, false);"

# 10 开卷第一屏（卷首村口）
# 动作留空即可：`_resetView()` 给的正是 `goTo(240, fitHeightScale)` 的结果
# （world x 被夹到 0、y 0、scale 0.8），也就是用户点「展卷」后看到的那一屏。
# 单独出一张是因为这一屏最容易被忽略：客栈/井/妇人童子老叟全在这里，
# 一旦把地标摆到卷尾，展示图里就只剩山水，看着像「没有人间烟火」。
shoot "10-opening.png" ""

echo "完成。"
