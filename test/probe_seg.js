/* 临时探针：把用户截图里的真实识别文字喂给页面的切段/清洗逻辑，看它怎么切的 */
const { app, BrowserWindow } = require("electron");
const path = require("path");

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

const INDEX = path.join(__dirname, "..", "www", "index.html");

const PROBE = `
(async function () {
  const out = [];
  function p(k, v){ out.push(k + " = " + v); }
  await new Promise(r => setTimeout(r, 300));

  // 用户截图 #3 + #4 里识别出的文字（题干带题库名/进度/分值，选项单独一段）
  const cases = {
    "截图3 原文": "2026版《煤矿重大事故隐患判定标准》\\n（… 3/20\\n（1.0分）带式输送机输送带入井前应经过什么试验？",
    "截图3 单行粘": "2026版《煤矿重大事故隐患判定标准》（… 3/20\\n（1.0分）带式输送机输送带入入井前应经过什么试验？",
    "题干+选项合起来": "2026版《煤矿重大事故隐患判定标准》（… 3/20\\n（1.0分）带式输送机输送带入井前应经过什么试验？\\nA 强度试验\\nB 阻燃试验\\nC 耐磨试验\\nD 防水试验",
    "干净题干（对照）": "带式输送机输送带入井前应经过什么试验？"
  };

  for (const name in cases) {
    const t = cases[name];
    p("---- " + name + " ----", "");
    t.split("\\n").forEach(function (ln, i) {
      p("   行" + (i+1) + " [" + qLineKind(ln) + "]", JSON.stringify(ln));
    });
    const seg = qSegments(t);
    p("   qSegments 段数", seg.segs.length + "  noise=" + seg.noise);
    seg.segs.forEach(function (s, i) {
      p("     段" + (i+1) + " stem", JSON.stringify(s.stem.join(" | ")));
      p("     段" + (i+1) + " opts", JSON.stringify(s.opts.join(" | ")));
    });
    const plan = qPlan(t);
    p("   qPlan.use", plan.use);
    p("", "");
  }

  // 结果卡片的 HTML 结构（看布局为什么被挤窄）
  const it = DATA.items.find(function (x) { return x && x.q && x.q.length > 30; }) || DATA.items[0];
  if (it) {
    const h = qCardFull(it, 1);
    p("---- 结果卡片 HTML（前 900 字）----", "");
    out.push(h.slice(0, 900));
    p("", "");
    p("卡片类名遇到的情况", JSON.stringify((h.match(/class="[^"]+"/g) || []).slice(0, 14)));
  }
  return out;
})();
`;

let win = null;
app.whenReady().then(function () {
  win = new BrowserWindow({
    width: 430, height: 932, show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-stub.js"),
      contextIsolation: false, nodeIntegration: false
    }
  });
  win.webContents.on("did-finish-load", function () {
    setTimeout(function () {
      win.webContents.executeJavaScript(PROBE, true).then(function (rows) {
        console.log("\n============ 切段逻辑探针 ============");
        rows.forEach(function (r) { console.log("  " + r); });
        app.exit(0);
      }).catch(function (e) {
        console.log("探针失败：" + (e && e.message));
        app.exit(1);
      });
    }, 400);
  });
  win.loadFile(INDEX);
});
