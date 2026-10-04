/* =====================================================================
 * build_www.js —— 把「电脑版」网页打包成 iOS 工程内的 www/index.html
 * ---------------------------------------------------------------------
 * v3（2026-10-04）：改为「单一基线」构建 ——
 *   唯一源 = E:/workbuddy/2026-08-23-17-55-30/desktop/搜题平台.html（v1.0.61）
 *   手机端不再维护自己的网页副本，所有差异都收敛到 www/app-bridge.js。
 *
 * 产物：
 *   www/index.html        ← 电脑版网页 + 注入了 <script src="app-bridge.js">
 *   www/lib/jszip.min.js      （试卷 docx 打包用）
 *   www/lib/docx-preview.min.js（试卷 docx 真实渲染用）
 *
 * 关键点：桥接脚本必须注入在**网页主体 <script> 之前** ——
 *   网页里 `const desktopFS = window.fsBridge || null` 是同步求值，
 *   晚一步 desktopFS 就是 null，本地文件持久化整条链路失效。
 * ===================================================================== */
const fs = require("fs");
const path = require("path");

const DESKTOP_DIR = "E:/workbuddy/2026-08-23-17-55-30/desktop";
const SRC_HTML = path.join(DESKTOP_DIR, "搜题平台.html");
const SRC_LIB_DIR = path.join(DESKTOP_DIR, "lib");

const OUT_DIR = path.join(__dirname, "www");
const OUT_HTML = path.join(OUT_DIR, "index.html");
const OUT_LIB_DIR = path.join(OUT_DIR, "lib");

const BRIDGE_TAG = '<script src="app-bridge.js"></script>';

/* 允许命令行覆盖源路径（方便复测别的版本） */
const argv = process.argv.slice(2);
const srcHtml = argv[0] || SRC_HTML;

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

if (!fs.existsSync(srcHtml)) fail("找不到电脑版网页：" + srcHtml);

let html = fs.readFileSync(srcHtml, "utf8");
const beforeBytes = Buffer.byteLength(html, "utf8");

/* ---------- 1. 定位主体 <script> 的位置 ---------- */
/* 用「存储层」注释作为锚点，它是主体脚本的第一段内容；
   再回退到它前面最近的一个裸 <script>（不带 src 的那个）。 */
const ANCHOR = "/* ============ 存储层 ============ */";
const anchorIdx = html.indexOf(ANCHOR);
if (anchorIdx < 0) fail("找不到锚点「存储层」，电脑版网页结构可能变了");

const openTagIdx = html.lastIndexOf("<script>", anchorIdx);
if (openTagIdx < 0) fail("在锚点之前找不到主体 <script> 开标签");

/* ---------- 2. 幂等检查 ---------- */
if (html.indexOf(BRIDGE_TAG) >= 0) {
  console.log("已注入 app-bridge.js，先移除旧注入再重新注入");
  html = html.replace(BRIDGE_TAG, "");
}

/* ---------- 3. 注入桥接脚本 ---------- */
html = html.slice(0, openTagIdx) + BRIDGE_TAG + "\n" + html.slice(openTagIdx);

/* ---------- 4. 版本号标注手机版 ---------- */
/* 额外带一个「手机版构建号 mN」：手机版和电脑版共用 vX.Y.Z（单一源），
   但手机版会独立修补，装了新版却看不出来是哪个 —— 这个 mN 就是给用户
   核对"我装的到底是不是刚出的那个包"用的。改手机版配套文件时手动 +1。 */
const MOBILE_BUILD = "m4";   // m1 = 首次移植 v3.0；m2 = 修复导入 + 大文件分块；
                             // m3 = 相册取图 + 快捷指令别名 + 剪贴板监听 + 内置题库装载；
                             // m4 = 跟随电脑版 v1.0.62（输入清洗/选项识别）+ 删掉最近搜过 + 结果卡片版面
const verRe = /当前版本 <b>(v[0-9.]+)<\/b>/;
const m = verRe.exec(html);
if (m) {
  html = html.replace(
    verRe,
    '当前版本 <b>' + m[1] + '</b> <span style="display:inline-block;padding:1px 8px;border-radius:8px;' +
    'background:#eaf1ff;color:#1d4ed8;font-size:12px;font-weight:600;margin-left:2px;">手机版 · iOS ' +
    MOBILE_BUILD + '</span>'
  );
  console.log("版本号已标注：" + m[1] + "（手机版 · iOS " + MOBILE_BUILD + "）");
} else {
  console.warn("⚠ 没找到「当前版本 vX.Y.Z」字样，跳过版本标注");
}

/* ---------- 5. 写 www/index.html ---------- */
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_HTML, html, "utf8");

/* ---------- 6. 拷贝外部库 ---------- */
if (!fs.existsSync(OUT_LIB_DIR)) fs.mkdirSync(OUT_LIB_DIR, { recursive: true });
const LIBS = ["jszip.min.js", "docx-preview.min.js"];
LIBS.forEach(function (f) {
  const s = path.join(SRC_LIB_DIR, f);
  if (!fs.existsSync(s)) {
    console.warn("⚠ 缺少库文件：" + s + "（试卷 docx 真实渲染可能不可用）");
    return;
  }
  fs.copyFileSync(s, path.join(OUT_LIB_DIR, f));
});

/* ---------- 7. 自检 ---------- */
const out = fs.readFileSync(OUT_HTML, "utf8");
const bridgePos = out.indexOf(BRIDGE_TAG);
const storePos = out.indexOf(ANCHOR);
const checks = [
  ["app-bridge.js 已注入", bridgePos >= 0],
  ["桥接脚本位于主体脚本之前", bridgePos >= 0 && bridgePos < storePos],
  ["含 v-ocr 页", out.indexOf('id="v-ocr"') >= 0],
  ["含 v-search 页", out.indexOf('id="v-search"') >= 0],
  ["含底部导航 .bot", out.indexOf('class="bot"') >= 0],
  ["含移动端媒体查询 @media(max-width:768px)", out.indexOf("@media(max-width:768px)") >= 0],
  ["含 v1.0.61 按坐标重排", out.indexOf("function sortOcrBlocks") >= 0],
  ["含 v1.0.61 质量闸门", out.indexOf("function ocrGate") >= 0],
  ["含 v1.0.60 换行修复", out.indexOf("setSearchText") >= 0 && out.indexOf("\\u2028") >= 0],
  ["含 v1.0.61 识别历史", out.indexOf("souti_ocrHist") >= 0]
];
let bad = 0;
checks.forEach(function (c) {
  if (!c[1]) bad++;
  console.log((c[1] ? "  ✓ " : "  ✗ ") + c[0]);
});

console.log(
  "\n源：" + srcHtml +
  "\n出：" + OUT_HTML +
  "\n体积：" + (beforeBytes / 1024).toFixed(0) + " KB → " + (Buffer.byteLength(out, "utf8") / 1024).toFixed(0) + " KB"
);
if (bad) fail(bad + " 项自检未通过");
console.log("构建完成 ✓");
