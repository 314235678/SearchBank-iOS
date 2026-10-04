/* =====================================================================
 * iOS 版端到端验证（Electron 无头跑 www/index.html）
 * ---------------------------------------------------------------------
 * 用 preload 桩把 window.webkit.messageHandlers.bridge 造出来，
 * 于是页面会以为自己跑在真机 WKWebView 里，桥接层走完整真实路径。
 *
 * 检查三件事：
 *   ① 静态：电脑版 386 个函数在打包后的 index.html 里**一个不少**
 *   ② 运行时：5 个桥接对象齐、页面零报错、关键 DOM 存在
 *   ③ 行为：整页净化 / v2.19 回归 / AI 裁剪 / AI 精读回填 / 深链
 *
 * 用法：
 *   electron test/e2e_mobile.js
 * ===================================================================== */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

const WWW = path.join(__dirname, "..", "www");
const INDEX = path.join(WWW, "index.html");
const DESKTOP_HTML = "E:/workbuddy/2026-08-23-17-55-30/desktop/搜题平台.html";

const rows = [];
function chk(name, pass, extra) {
  rows.push({ name: name, pass: !!pass, extra: extra || "" });
}

/* ---------------- 静态检查：桌面函数一个不少 ---------------- */
function staticCheck() {
  const desktop = fs.readFileSync(DESKTOP_HTML, "utf8");
  const built = fs.readFileSync(INDEX, "utf8");
  const names = new Set();
  const re = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let m;
  while ((m = re.exec(desktop)) !== null) names.add(m[1]);
  const missing = [];
  names.forEach(function (n) {
    if (built.indexOf(n) < 0) missing.push(n);
  });
  chk("静态：电脑版函数总数 = " + names.size, names.size > 300, String(names.size));
  chk("静态：打包后一个函数都不缺", missing.length === 0,
    missing.length ? ("缺 " + missing.length + " 个：" + missing.slice(0, 12).join(", ")) : "全部在位");
  return names.size;
}

/* ---------------- 页面内测试脚本 ---------------- */
const PAGE_TESTS = `
(async function () {
  const R = [];
  function chk(name, pass, extra){ R.push({ name: name, pass: !!pass, extra: extra == null ? "" : String(extra) }); }
  function blk(text, x, y, w, h){
    return { text: text, score: 0.9, box: [[x,y],[x+w,y],[x+w,y+h],[x,y+h]] };
  }

  // ---------- 1. 桥接对象 ----------
  ["fsBridge","umiBridge","aiBridge","batchBridge","wpsBridge","Tesseract"].forEach(function(n){
    chk("桥接对象 window." + n + " 存在", window[n] && typeof window[n] === "object");
  });
  chk("被识别为原生环境 __SB.native", window.__SB && window.__SB.native === true);
  ["ocr","ocrBlocks","aiAsk","aiProof","aiRecognize","aiChat","shareBinary","loadData","saveData"]
    .forEach(function(n){
      chk("原生通道 __SB." + n, typeof (window.__SB||{})[n] === "function");
    });

  // ---------- 2. 关键 DOM ----------
  ["v-ocr","v-search","v-import","v-manage","v-paper","v-train","ocrShot","ocrAi","searchInput","bot"]
    .forEach(function(id){
      chk("元素 #" + id, !!document.getElementById(id));
    });
  chk("整页净化开关按钮已注入 #sbAiFirst", !!document.getElementById("sbAiFirst"));
  chk("整页净化开关按钮已注入 #sbPageClean", !!document.getElementById("sbPageClean"));

  // ---------- 3. 整页净化（合成一张"整屏截图"的识别结果）----------
  const page = {
    blocks: [
      blk("18:37",        60,   12, 60, 22),
      blk("5G",          820,   12, 30, 22),
      blk("学习强企",     380,   70, 140, 40),
      blk("考试复习",     380,  130, 140, 36),
      blk("2/10",        830,  140, 50, 24),
      blk("单选题",        60,  430, 80, 30),
      blk("2、为预防工作面两端发生漏顶事故，应当采取", 60, 480, 780, 34),
      blk("的措施是（）。", 60,  526, 220, 34),
      blk("模糊的",        60,  570, 90, 34),
      blk("A．加强支护",   90,  640, 300, 34),
      blk("B．加强通风",   90,  690, 300, 34),
      blk("C．加强监测",   90,  740, 300, 34),
      blk("D．以上都是",   90,  790, 300, 34),
      blk("1/10",         60, 1700, 60, 24),
      blk("上一题",      300, 1740, 120, 40),
      blk("下一题",      560, 1740, 120, 40),
      blk("答题卡",      300, 1790, 120, 30)
    ],
    w: 900, h: 1800, scale: 1, cropTop: 0, cropBottom: 0, ow: 900, oh: 1800
  };
  const san = window.__SB.__test.sanitizePage(page);
  const s = san.stats;
  const keptText = san.plainRows.map(function(r){ return r.text; }).join("\\n");

  // 17 个 block 按行高分组后 = 14 行（3 处同行合并）：
  //   「18:37」+「5G」、「考试复习」+「2/10」、「上一题」+「下一题」
  // 其中题目区 7 行（题干首行/续行/「模糊的」/A/B/C/D），界面文字 7 行
  chk("净化：17 块合并成 14 行", s.totalRows === 14, s.totalRows);
  chk("净化：只留题目区 7 行", s.keptRows === 7, s.keptRows);
  chk("净化：去掉 7 行界面文字", s.droppedRows === 7, s.droppedRows);
  chk("净化：剔除状态栏时间「18:37」", keptText.indexOf("18:37") < 0);
  chk("净化：剔除 App 标题「学习强企」", keptText.indexOf("学习强企") < 0);
  chk("净化：剔除进度「2/10」", keptText.indexOf("2/10") < 0);
  chk("净化：剔除按钮「上一题」", keptText.indexOf("上一题") < 0);
  chk("净化：剔除底栏「答题卡」", keptText.indexOf("答题卡") < 0);
  chk("净化：保留题干首行", keptText.indexOf("为预防工作面两端发生漏顶") >= 0);
  chk("净化：保留题干续行「的措施是（）。」", keptText.indexOf("的措施是") >= 0);
  // v2.19 回归：纯中文短行绝不能被当成噪声删掉
  chk("v2.19 回归：纯中文短行「模糊的」被保留", keptText.indexOf("模糊的") >= 0);
  chk("净化：保留 4 个选项", ["A．加强支护","B．加强通风","C．加强监测","D．以上都是"]
    .every(function(t){ return keptText.indexOf(t) >= 0; }));
  chk("净化：算出题目区包围盒", !!s.origBox,
    s.origBox ? JSON.stringify(s.origBox) : "null");
  chk("净化：包围盒 x0=60", s.origBox && s.origBox.x0 === 60, s.origBox && s.origBox.x0);
  chk("净化：包围盒 y0=480", s.origBox && s.origBox.y0 === 480, s.origBox && s.origBox.y0);
  chk("净化：包围盒 y1=824", s.origBox && s.origBox.y1 === 824, s.origBox && s.origBox.y1);
  chk("净化：没走保守兜底", s.fallback === false);

  // 纯符号行判定（v2.19 的反面：真符号行要删）
  chk("净化：纯符号行「•••」被剔除", window.__SB.__test.looksLikeUIRow("•••").ui === true);
  chk("净化：纯中文行「可计算的」不被剔除", window.__SB.__test.looksLikeUIRow("可计算的").ui === false);
  chk("净化：题干含「考试」二字不被当界面词", window.__SB.__test.looksLikeUIRow("下列关于考试的说法").ui === false);
  chk("净化：独立成行的「单选题」被剔除", window.__SB.__test.looksLikeUIRow("单选题").ui === true);

  // ---------- 4. AI 裁剪：只发题目区，不发整屏 ----------
  window.__STUB.aiResult = { ok: true, content: JSON.stringify({
      type: "单选题",
      stem: "为预防工作面两端发生漏顶事故，应当采取的措施是（）",
      options: [{label:"A",text:"加强支护"},{label:"B",text:"加强通风"},
                {label:"C",text:"加强监测"},{label:"D",text:"以上都是"}],
      answer: "A"
    }) };
  localStorage.setItem("wb_searchbank_settings", JSON.stringify({
    models: [{ id:"m1", name:"测试模型", baseUrl:"https://api.deepseek.com",
               apiKey:"sk-test", modelName:"deepseek-chat", default:true }]
  }));

  // 造一张 900x1800 的"整屏截图"
  const c0 = document.createElement("canvas");
  c0.width = 900; c0.height = 1800;
  const g0 = c0.getContext("2d");
  g0.fillStyle = "#ffffff"; g0.fillRect(0,0,900,1800);
  g0.fillStyle = "#333"; g0.font = "30px sans-serif";
  for (let i = 0; i < 40; i++) g0.fillText("line " + i, 60, 40 + i*42);
  const bigUrl = c0.toDataURL("image/jpeg", 0.9);

  window.__SB.__lastLocalOCR = {
    ts: Date.now(), stats: s, origBox: s.origBox, raw: page.blocks, kept: san.blocks
  };
  const before = window.__STUB_LOG.length;
  const aiR = await window.aiBridge.recognize({
    model: { baseUrl:"https://api.deepseek.com", apiKey:"sk-test", modelName:"deepseek-chat" },
    image: bigUrl
  });
  chk("AI 调用返回成功", aiR && aiR.ok === true, aiR && aiR.error);
  const sent = window.__STUB_LOG.slice(before).filter(function(x){ return x.type === "aiRecognize"; });
  chk("确实向原生发出了 aiRecognize", sent.length === 1, sent.length);

  let cropOk = false, cropInfo = "没拿到发出的图";
  if (sent.length) {
    const outUrl = sent[0].payload.image || "";
    chk("发给 AI 的不是原图（已被裁剪）", outUrl !== bigUrl);
    cropInfo = await new Promise(function(res){
      const im = new Image();
      im.onload = function(){ res(im.naturalWidth + "x" + im.naturalHeight); };
      im.onerror = function(){ res("解码失败"); };
      im.src = outUrl;
    });
    const mm = /^(\\d+)x(\\d+)$/.exec(cropInfo);
    if (mm) {
      const w = +mm[1], h = +mm[2];
      chk("裁剪后高度明显小于整屏 1800（实测 " + cropInfo + "）", h < 1800 * 0.6, cropInfo);
      chk("裁剪后宽度不超过原图宽度", w <= 900, w);
      chk("裁剪后仍包含题目纵向区间（约 400px 高）", h >= 300 && h <= 700, h);
      cropOk = true;
    }
  }
  chk("裁剪尺寸可解码", cropOk, cropInfo);

  // ---------- 5. AI 精读真的把结果填回文字框 ----------
  window.__SB.__lastLocalOCR = null;   // 这一轮不裁剪，单独验回填链路
  if (typeof go === "function") go("ocr");
  _ocrState.file = new File([new Uint8Array([1,2,3,4])], "shot.jpg", { type: "image/jpeg" });
  _ocrState.imgSrc = "data:image/jpeg;base64,AQIDBA==";
  const logBefore = window.__STUB_LOG.length;
  await ocrAiRead();
  const aiCalls = window.__STUB_LOG.slice(logBefore).filter(function(x){ return x.type === "aiRecognize"; });
  chk("点「AI 精读」发出了 aiRecognize", aiCalls.length === 1, aiCalls.length);
  const txt = (document.getElementById("ocrText") || {}).value || "";
  chk("AI 结果已填进文字框", txt.indexOf("漏顶事故") >= 0, txt.slice(0, 40));
  chk("AI 结果含选项 A", txt.indexOf("A．加强支护") >= 0 || txt.indexOf("A. 加强支护") >= 0, txt.slice(0, 60));
  chk("识别引擎标记为 AI", _ocrState.engine === "AI 视觉识别", _ocrState.engine);
  chk("结构化结果已保存 _ocrState.struct", !!_ocrState.struct);

  // ---------- 6. AI 优先开关 ----------
  const bAi = document.getElementById("sbAiFirst");
  chk("AI 优先默认开启", localStorage.getItem("sb_ocr_ai_first") !== "0");
  chk("按钮文案显示「开」", bAi && bAi.textContent.indexOf("开") >= 0, bAi && bAi.textContent);
  bAi.click();
  chk("点一下后关闭（写入 0）", localStorage.getItem("sb_ocr_ai_first") === "0");
  chk("按钮文案显示「关」", bAi.textContent.indexOf("关") >= 0, bAi.textContent);
  bAi.click();
  chk("再点一下恢复开启", localStorage.getItem("sb_ocr_ai_first") !== "0");

  // ---------- 7. 深链 ----------
  window.__SB.handleDeepLink("searchbank://search?q=" + encodeURIComponent("煤矿安全"));
  await new Promise(function(r){ setTimeout(r, 80); });
  const vs = document.getElementById("v-search");
  chk("深链跳到试题搜索页", vs && vs.classList.contains("on"));
  const q = document.getElementById("searchInput");
  chk("深链把题干填进搜索框", q && q.value.indexOf("煤矿安全") >= 0, q && q.value);

  // ---------- 8. 设置本地化 ----------
  const opt = document.querySelector('#setEngine option[value="umi"]');
  chk("OCR 引擎选项已改成 iOS 措辞", opt && opt.textContent.indexOf("iOS") >= 0,
    opt && opt.textContent);
  const hint = document.getElementById("ocrHint");
  chk("图片识别页提示已改成 AI 优先说明",
    hint && hint.textContent.indexOf("AI 优先") >= 0);

  // ---------- 9. 搜索历史条 ----------
  chk("搜索历史容器已建立 #sbHistBar", !!document.getElementById("sbHistBar"));

  // ---------- 10. 移动端样式 ----------
  chk("iOS 补充样式已注入 #sb-ios-style", !!document.getElementById("sb-ios-style"));
  const bot = document.getElementById("bot");
  chk("底部导航有 7 项", bot && bot.querySelectorAll("button").length === 7,
    bot && bot.querySelectorAll("button").length);

  // ---------- 11. 导入电脑版备份（v3.0.1 修复的「静默失效」bug）----------
  // 历史：首版桥接写成 isFn("ingestBackup") && window.ingestBackup(...)，
  // 但网页里根本没有这个函数 → 判断恒假 → 不执行也不报错 → "导入没反应"。
  chk("桥接已定义 window.ingestBackup", typeof window.ingestBackup === "function");

  function maskOpen() {
    const m = document.getElementById("mask");
    return !!(m && m.classList.contains("on"));
  }
  function okBtn() {
    const m = document.getElementById("mask");
    if (!m) return null;
    const b = m.querySelectorAll("button");
    for (let i = 0; i < b.length; i++) {
      if (b[i].textContent.trim() === "确定") return b[i];
    }
    return null;
  }
  /* 上一步的确认弹窗若没关，会被下一步的轮询点掉，造成串扰
     （首版测试就栽在这：小备份的弹窗被大备份那步点了，导致断言全错位）。
     所以每次导入前先清干净。 */
  function ensureMaskClosed() {
    if (!maskOpen()) return;
    const m = document.getElementById("mask");
    const b = m.querySelectorAll("button");
    for (let i = 0; i < b.length; i++) {
      if (b[i].textContent.trim() === "取消") { b[i].click(); return; }
    }
    if (typeof closeMask === "function") closeMask();
  }
  async function waitFor(fn, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (fn()) return true; } catch (e) {}
      await new Promise(function (r) { setTimeout(r, 40); });
    }
    return false;
  }
  // 确定性流程：确保无残留弹窗 → 点导入 → 等弹窗 → 点确定 → 等合并生效
  async function importFlow(timeoutMs) {
    ensureMaskClosed();
    await new Promise(function (r) { setTimeout(r, 80); });
    const before = DATA.items.length;
    document.getElementById("btnImport").click();
    if (!(await waitFor(maskOpen, timeoutMs || 6000))) {
      return { ok: false, reason: "确认弹窗始终没出现", before: before, after: DATA.items.length };
    }
    const b = okBtn();
    if (!b) return { ok: false, reason: "找不到确定按钮", before: before, after: DATA.items.length };
    b.click();
    const merged = await waitFor(function () { return DATA.items.length > before; }, 4000);
    return { ok: merged, reason: merged ? "" : "点了确定但没合并",
             before: before, after: DATA.items.length };
  }
  function b64utf8(s) { return btoa(unescape(encodeURIComponent(s))); }

  // 11a. 小文件 → 仍走 base64 路径
  const smallBackup = JSON.stringify({
    items: [{ id: "", type: "单选题", stem: "导入测试-小文件", opts: ["甲", "乙"], ans: "A" }],
    banks: [{ id: "bk-import-small", name: "导入题库-小" }]
  });
  window.__STUB.pickFilesResult = [{
    name: "小备份.json", mime: "application/json",
    data: b64utf8(smallBackup), size: smallBackup.length
  }];
  const f1 = await importFlow(5000);
  chk("小备份(base64)导入成功", f1.ok, f1.reason || (f1.before + " → " + f1.after));
  chk("小备份题干未损坏",
    DATA.items[DATA.items.length - 1] && DATA.items[DATA.items.length - 1].stem === "导入测试-小文件",
    DATA.items[DATA.items.length - 1] && DATA.items[DATA.items.length - 1].stem);
  chk("备份里的题库定义已合并",
    (DATA.banks || []).some(function (b) { return b.id === "bk-import-small"; }));

  // 11b. 大文件 → 原生暂存 + 分块读取（真机 8MB 备份走这条）
  const filler = "为预防工作面两端发生漏顶事故，应当采取的措施是加强支护与监测。";
  let pad = "";
  while (pad.length < 4000) pad += filler;
  const bigItems = [];
  for (let i = 0; i < 300; i++) {
    bigItems.push({ id: "", type: "单选题", stem: pad.slice(0, 3800) + "大文件-" + i,
                    opts: ["甲", "乙", "丙", "丁"], ans: "A" });
  }
  const bigBackup = JSON.stringify({
    items: bigItems, banks: [{ id: "bk-import-big", name: "导入题库-大" }]
  });
  const buf = window.__STUB.utf8Bytes(bigBackup);
  window.__STUB.stagedBytes = buf;
  window.__STUB.pickFilesResult = [{
    name: "大备份.json", mime: "application/json", staged: true, size: buf.length
  }];
  chk("大备份样本 > 3MB（触发分块路径）", buf.length > 3 * 1024 * 1024,
    (buf.length / 1048576).toFixed(2) + " MB");

  // 关键：断言样本真的让分块边界落在一个汉字的中间字节上。
  // 若桥接逐块 decode 而不是在字节层拼接，这里必然出错 —— 测试才有意义。
  const CH = 262144;
  let splitMidChar = false;
  for (let off = CH; off < buf.length; off += CH) {
    if ((buf[off] & 0xC0) === 0x80) { splitMidChar = true; break; }
  }
  chk("样本确实让分块边界切在汉字中间（否则测不到风险点）", splitMidChar);

  const chunkBefore = window.__STUB_LOG.filter(function (x) { return x.type === "readImportChunk"; }).length;
  const f2 = await importFlow(9000);
  const chunkCalls = window.__STUB_LOG.filter(function (x) { return x.type === "readImportChunk"; }).length - chunkBefore;

  chk("大备份(分块)导入成功", f2.ok, f2.reason || (f2.before + " → " + f2.after));
  chk("分块读取确实调用了多次", chunkCalls > 1, chunkCalls + " 次");
  const firstBig = DATA.items[f2.before];
  chk("大备份首条题干逐字一致（证明分块拼接未损坏 UTF-8）",
    !!firstBig && firstBig.stem === bigItems[0].stem,
    firstBig ? ("长度 " + firstBig.stem.length + " vs 期望 " + bigItems[0].stem.length) : "缺失");
  const lastBig = DATA.items[DATA.items.length - 1];
  chk("大备份末条题干逐字一致",
    !!lastBig && lastBig.stem === bigItems[bigItems.length - 1].stem);
  chk("大备份里的题库定义已合并",
    (DATA.banks || []).some(function (b) { return b.id === "bk-import-big"; }));

  // 11c. 拿不到备份内容时必须给出提示，而不是静默
  ensureMaskClosed();
  await new Promise(function (r) { setTimeout(r, 80); });
  const tEl = document.getElementById("toast");
  if (tEl) tEl.textContent = "";
  window.__STUB.pickFilesResult = [{ name: "空文件.json", mime: "application/json" }];
  document.getElementById("btnImport").click();
  await new Promise(function (r) { setTimeout(r, 400); });
  chk("拿不到内容时给出明确提示（不再静默无反应）",
    tEl && /拿不到文件内容|恢复失败|导入失败/.test(tEl.textContent), tEl && tEl.textContent);

  return { rows: R, errors: window.__PAGE_ERRORS || [] };
})();
`;

/* ---------------- 主流程 ---------------- */
let desktopFnCount = 0;

app.whenReady().then(function () {
  desktopFnCount = staticCheck();

  const win = new BrowserWindow({
    width: 430,
    height: 932,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-stub.js"),
      contextIsolation: false,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  const consoleErrors = [];
  win.webContents.on("console-message", function (a, b, c) {
    // Electron 新旧两种回调签名都兼容
    const level = (b && typeof b === "object") ? b.level : b;
    const message = (b && typeof b === "object") ? b.message : c;
    const isErr = (level === 3) || (level === "error");
    if (isErr) consoleErrors.push(String(message));
  });

  win.webContents.on("did-finish-load", function () {
    setTimeout(function () {
      win.webContents
        .executeJavaScript(PAGE_TESTS, true)
        .then(function (res) {
          (res.rows || []).forEach(function (r) { chk(r.name, r.pass, r.extra); });

          const pageErrors = res.errors || [];
          chk("页面无未捕获 JS 报错", pageErrors.length === 0,
            pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "无");
          chk("控制台无 error 级输出", consoleErrors.length === 0,
            consoleErrors.length ? consoleErrors.slice(0, 3).join(" | ") : "无");

          finish();
        })
        .catch(function (err) {
          chk("页面测试脚本本身执行成功", false, err && err.message);
          finish();
        });
    }, 500);
  });

  win.loadFile(INDEX);
});

function finish() {
  let pass = 0, fail = 0;
  console.log("\n================ iOS 版端到端验证 ================");
  console.log("电脑版函数基线：" + desktopFnCount + " 个\n");
  rows.forEach(function (r) {
    if (r.pass) { pass++; console.log("  ✓ " + r.name + (r.extra ? "  [" + r.extra + "]" : "")); }
    else { fail++; console.log("  ✗ " + r.name + (r.extra ? "  [" + r.extra + "]" : "")); }
  });
  console.log("\n通过 " + pass + " / 失败 " + fail + "（共 " + rows.length + " 项）");
  if (fail) console.log("\nE2E_RESULT_FAIL");
  else console.log("\nE2E_RESULT_OK");
  app.exit(fail ? 1 : 0);
}

setTimeout(function () {
  console.log("超时退出");
  finish();
}, 90000);
