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

  /* m6：WKWebView 里 confirm()/alert() 只有宿主实现了 WKUIDelegate 才会弹窗，
     否则 WebKit 直接返回 false / 什么都不做。网页里「删除模型」「清空会话」都是
     `if(!confirm(...))return;`，于是表现为"点了没反应"。这几条静态守住"必须实现"。 */
  const swiftDir = path.join(__dirname, "..", "SearchBank");
  const vc = fs.readFileSync(path.join(swiftDir, "ViewController.swift"), "utf8");
  const shim = fs.readFileSync(path.join(swiftDir, "OpenPanelShim.m"), "utf8");
  const store = fs.readFileSync(path.join(swiftDir, "LocalStore.swift"), "utf8");
  chk("静态：实现了 runJavaScriptConfirmPanel（删除等确认框的前提）",
    /runJavaScriptConfirmPanelWithMessage/.test(vc));
  chk("静态：实现了 runJavaScriptAlertPanel", /runJavaScriptAlertPanelWithMessage/.test(vc));
  chk("静态：实现了 runJavaScriptTextInputPanel", /runJavaScriptTextInputPanelWithPrompt/.test(vc));
  chk("静态：OpenPanelShim 把这三个委托转回 Swift",
    /runJavaScriptConfirmPanelWithMessage/.test(shim) && /runJavaScriptAlertPanelWithMessage/.test(shim));
  chk("静态：原生有 loadSettings / saveSettings 通道",
    /case "loadSettings"/.test(vc) && /case "saveSettings"/.test(vc));
  chk("静态：设置写到沙盒 settings.json（不是再写一份 localStorage）",
    /settingsFileURL/.test(store) && /settings\.json/.test(store));
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
  // 整段包一层 try/catch：chks 是最后统一 return 的，中途抛错会把已有结果全丢掉，
  // 只留一句 Electon 的 "Script failed to execute"。这里把真实错误带回去。
  try {
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

  // ---------- 9. 搜索历史条（v3.0.3 按用户要求移除）----------
  // 连搜几道题后那排「最近搜过」胶囊会占掉小半屏，把搜索结果挤下去。
  chk("「最近搜过」已移除（不再注入 #sbHistBar）", !document.getElementById("sbHistBar"));
  chk("残留的 localStorage 键已清掉",
    localStorage.getItem("sb_search_hist") === null,
    localStorage.getItem("sb_search_hist"));

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

  // ---------- 12. 图片来源（相册/相机）+ 快捷指令深链 ----------
  // 用户报的问题①：点「图片识别搜题」的取图框，弹出的是「文件」App，
  //   里面找不到刚截的图，等于没法选图。
  //   根因：网页的取图入口是 <input type="file" id="imgInput">（点击 → 文件面板），
  //   而旧手机版是靠自有 FAB 走相册；新版从电脑版重建后这条口子漏接了。
  chk("已注入拍照按钮 #sbOcrCam", !!document.getElementById("sbOcrCam"));

  let imgCalls = 0, lastImgFile = null;
  const origHandleImage = window.handleImage;
  window.handleImage = function (f) { imgCalls++; lastImgFile = f; };

  const dropEl = document.getElementById("imgDrop");
  const logN = window.__STUB_LOG.length;
  dropEl.click();
  await new Promise(function (r) { setTimeout(r, 350); });
  const srcTypes = window.__STUB_LOG.slice(logN).map(function (x) { return x.type; });
  chk("点取图框发出 pickImage（走系统相册）", srcTypes.indexOf("pickImage") >= 0, srcTypes.join(","));
  chk("点取图框没有再走文件选择器 pickFiles", srcTypes.indexOf("pickFiles") < 0, srcTypes.join(","));
  chk("相册返回的图交给了 handleImage", imgCalls === 1, "handleImage 调用 " + imgCalls + " 次");
  chk("交给 handleImage 的确是图片文件",
    !!lastImgFile && String(lastImgFile.type).indexOf("image/") === 0,
    lastImgFile && lastImgFile.type);
  chk("隐藏的 file input 已堵住（不再弹「文件」App）",
    String(document.getElementById("imgInput").click).indexOf("native code") < 0,
    String(document.getElementById("imgInput").click).slice(0, 40));

  const camN = window.__STUB_LOG.length;
  document.getElementById("sbOcrCam").click();
  await new Promise(function (r) { setTimeout(r, 350); });
  const camTypes = window.__STUB_LOG.slice(camN).map(function (x) { return x.type; });
  chk("拍照按钮发出 captureImage（相机）", camTypes.indexOf("captureImage") >= 0, camTypes.join(","));

  window.handleImage = origHandleImage;

  // 用户报的问题②：快捷指令只到「打开软件」那一步，不搜题。
  // 根因：快捷指令用的是 searchbank://fab-clipboard，
  //   而 v3.0 首版只认 fab-clip / clip，漏了这个别名 → 落到兜底
  //   swapToSearch("") → 只切页、搜索框是空的。
  window.__STUB.clipboard = "工作面漏顶事故应当采取的措施";
  let searchCalls = 0;
  const origDoSearch = window.doSearch;
  window.doSearch = function () { searchCalls++; return origDoSearch.apply(this, arguments); };

  window.__SB.handleDeepLink("searchbank://fab-clipboard");
  await new Promise(function (r) { setTimeout(r, 500); });
  const si = document.getElementById("searchInput");
  chk("fab-clipboard 把剪贴板内容填进搜索框",
    !!si && si.value.indexOf("漏顶事故") >= 0, si && si.value);
  chk("fab-clipboard 真的触发了搜索（不是只打开软件）",
    searchCalls >= 1, "doSearch 调用 " + searchCalls + " 次");
  const vs2 = document.getElementById("v-search");
  chk("fab-clipboard 已切到搜索页", !!(vs2 && vs2.classList.contains("on")));

  // 别名兼容：旧版还支持 fab-clip / clip；另外 launch 只开首页不搜题
  // （换一段不同的文字：同一段文字在 3 秒内会被判为「已搜过」而跳过，
  //   那是刻意的去重行为，见第 13 节）
  searchCalls = 0;
  window.__STUB.clipboard = "别名测试用的另一段题干文字内容";
  window.__SB.handleDeepLink("searchbank://fab-clip");
  await new Promise(function (r) { setTimeout(r, 400); });
  chk("fab-clip 别名同样能搜题", searchCalls >= 1, "doSearch 调用 " + searchCalls + " 次");

  searchCalls = 0;
  window.__SB.handleDeepLink("searchbank://launch");
  await new Promise(function (r) { setTimeout(r, 300); });
  chk("launch 只打开首页、不乱搜题", searchCalls === 0, "doSearch 调用 " + searchCalls + " 次");
  window.doSearch = origDoSearch;

  // ---------- 13. 剪贴板监听 ↔ 快捷指令 的互相去重 ----------
  // 两条路都会读到同一段文字（快捷指令是「拷贝→打开App」，监听每 1.2s 轮询），
  // 不管就会搜两遍、并多弹一次「允许粘贴」。
  // 但**不能只按文字去重**：监听走网页那套启发式过滤，可能把文字滤掉而没搜；
  // 那时快捷指令若也跳过，就一次都不搜了 —— 正是用户报的「只打开软件不搜题」。
  window.__STUB.clip = { changeCount: 100, kind: "text", text: "" };
  document.getElementById("btnScreenOcr").click();
  await new Promise(function (r) { setTimeout(r, 350); });
  chk("点「开始剪贴板监听」不再卡在 launchGui（iOS 无需 Umi-OCR）",
    document.getElementById("btnClipboardStop").style.display !== "none",
    "停止按钮 display=" + document.getElementById("btnClipboardStop").style.display);
  chk("按钮文案已本地化、不再提 Umi-OCR",
    document.getElementById("btnScreenOcr").textContent.indexOf("Umi-OCR") < 0,
    document.getElementById("btnScreenOcr").textContent);

  searchCalls = 0;
  window.doSearch = function () { searchCalls++; return origDoSearch.apply(this, arguments); };

  // 13a. 监听捕获到新文本 → 交给网页回调 → 自动搜题
  const WATCH_TEXT = "为预防工作面两端发生漏顶事故应当采取的措施是加强支护";
  window.__STUB.clip = { changeCount: 101, kind: "text", text: WATCH_TEXT };
  await new Promise(function (r) { setTimeout(r, 1700); });
  chk("监听捕获剪贴板新文本并自动搜题", searchCalls >= 1, "doSearch " + searchCalls + " 次");

  // 13b. 监听刚搜过的同一段文字 → 快捷指令不该再搜一遍
  searchCalls = 0;
  window.__STUB.clipboard = WATCH_TEXT;
  window.__SB.handleDeepLink("searchbank://fab-clipboard");
  await new Promise(function (r) { setTimeout(r, 500); });
  chk("监听刚搜过的同一段文字，快捷指令不重复搜", searchCalls === 0, "doSearch " + searchCalls + " 次");

  // 13c. 关键安全性质：监听被启发式过滤掉（太短、无中文）时，
  //      快捷指令必须照搜 —— 否则一次都不搜
  searchCalls = 0;
  window.__STUB.clip = { changeCount: 102, kind: "text", text: "hi" };
  await new Promise(function (r) { setTimeout(r, 1700); });
  chk("监听把「hi」过滤掉（没搜）", searchCalls === 0, "doSearch " + searchCalls + " 次");
  window.__STUB.clipboard = "hi";
  window.__SB.handleDeepLink("searchbank://fab-clipboard");
  await new Promise(function (r) { setTimeout(r, 600); });
  chk("监听被过滤时快捷指令仍会搜（不会一次都不搜）", searchCalls >= 1, "doSearch " + searchCalls + " 次");

  // 13d. 剪贴板里是图片 → 离线识别 + 净化 → 直接搜题
  searchCalls = 0;
  window.__STUB.clip = { changeCount: 103, kind: "image", dataUrl: window.__STUB.imageResult };
  await new Promise(function (r) { setTimeout(r, 1700); });
  chk("剪贴板图片会走识别链路（发出 ocrBlocks）",
    window.__STUB_LOG.filter(function (x) { return x.type === "ocrBlocks"; }).length > 0);

  // 收尾：停止监听，避免影响后面的用例
  document.getElementById("btnClipboardStop").click();
  await new Promise(function (r) { setTimeout(r, 200); });
  chk("停止监听按钮恢复状态",
    document.getElementById("btnScreenOcr").style.display !== "none");
  window.doSearch = origDoSearch;

  // ---------- 14. 内置题库装载 ----------
  // v3.0 首版这条链路**从来没成功过**：
  //   ① 用 window.DATA（网页是 let DATA，不在 window 上）→ 恒为 undefined
  //   ② fetch("搜题题库.json")（WKWebView 的 file:// 下被 WebKit 拦掉）
  // 现改为原生 getBundledBank + 裸标识符访问 DATA。
  localStorage.removeItem("sb_seeded");
  window.__STUB.bundledBank = JSON.stringify({
    items: [{ id: "seed1", q: "内置题库测试题一", a: "A", opts: [], type: "单选题",
              bankId: "bk-seed", cat: "", note: "", src: "内置" }],
    banks: [{ id: "bk-seed", name: "内置题库", color: "#2563eb" }]
  });
  await window.__SB.__test.seedFromBundle();
  chk("内置题库已装进 DATA", DATA.items.length === 1, DATA.items.length);
  chk("内置题库题目内容正确",
    DATA.items[0] && DATA.items[0].q === "内置题库测试题一",
    DATA.items[0] && DATA.items[0].q);
  chk("内置题库的题库定义一并合并",
    (DATA.banks || []).some(function (b) { return b.id === "bk-seed"; }));
  chk("数据就绪闸门已打开", window.__SB.__test.isDataReady() === true);

  // ---------- 15. 结果卡片版面（题干曾被挤成一条细柱）----------
  // 实测（430 宽）：修前题干只分到 136px（≈9 字/行），
  // 因为 .qh 是 flex 行、「相关度」胶囊 nowrap 独占 92px 把题干压窄。
  // 现在改成 grid：题干独占主行，标签/相关度落第二行。
  try {
    const probe = {
      id: "probe_layout_" + Date.now(),
      q: "带式输送机输送带入井前应经过什么试验？这是一道用来测版面的长题干，故意写长一点看它怎么换行。",
      a: "B", opts: [{ label: "A", text: "强度试验" }, { label: "B", text: "阻燃试验" }],
      type: "单选题", cat: "第一部分", bankId: (DATA.items[0] && DATA.items[0].bankId) || "default",
      note: "", src: "测试", createdAt: Date.now()
    };
    DATA.items.unshift(probe);
    go("search");
    setSearchText("带式输送机输送带入井前应经过什么试验");
    doSearch();
    await new Promise(function (r) { setTimeout(r, 1500); });

    const card = document.querySelector("#searchResults .qcard");
    chk("搜索结果渲染出卡片", !!card, card ? "有" : "没有（题库里可能没有匹配项）");
    if (card) {
      const qh = card.querySelector(".qh");
      const stem = qh && qh.children[1];
      const cardW = card.getBoundingClientRect().width;
      const stemW = stem ? stem.getBoundingClientRect().width : 0;
      chk(".qh 已改为 grid 版面（题干不再被 flex 挤压）",
        !!qh && getComputedStyle(qh).display === "grid",
        qh ? getComputedStyle(qh).display : "无 .qh");
      chk("题干宽度占卡片 ≥70%（修前约 40%）",
        stemW >= cardW * 0.7,
        Math.round(stemW) + "px / 卡片 " + Math.round(cardW) + "px = " +
        (cardW ? (stemW / cardW * 100).toFixed(0) : 0) + "%");
      const rel = qh && qh.querySelector(".rel");
      if (rel && stem) {
        chk("相关度胶囊已换到第二行（纵向在题干之下）",
          rel.getBoundingClientRect().top >= stem.getBoundingClientRect().bottom - 2,
          "题干底=" + Math.round(stem.getBoundingClientRect().bottom) +
          " 相关度顶=" + Math.round(rel.getBoundingClientRect().top));
      }
    }
    const k = DATA.items.indexOf(probe);
    if (k >= 0) DATA.items.splice(k, 1);
    setSearchText("");
    doSearch();
    await new Promise(function (r) { setTimeout(r, 300); });
  } catch (e) {
    chk("第 15 节（结果卡片版面）执行成功", false, (e && e.message) || String(e));
  }

  // ---------- 16. 输入清洗 + 选项识别（v1.0.62 共享逻辑，用户实测那道题）----------
  try {
    // 用户截图里的真实识别文字（题干+选项都识别到了，只是混进了库名/进度/分值）。
    // 注意段内必须写双反斜杠换行转义：本段处在模板字符串里，
    // 单反斜杠会被模板字符串先解释成真实换行，落进字符串字面量就是语法错误。
    const RAW_OCR = "2026版《煤矿重大事故隐患判定标准》\\n（… 3/20\\n（1.0分）带式输送机输送带入井前应经过什么试验？\\n"
      + "A 强度试验\\nB 阻燃试验\\nC 耐磨试验\\nD 防水试验";

    chk("页面提供了 cleanQueryText", typeof cleanQueryText === "function");
    const cleaned = cleanQueryText(RAW_OCR);
    chk("库名/进度/分值 被清掉（3 处）", cleaned.dropped === 3, cleaned.dropped);
    chk("清洗后不再含题库名", cleaned.text.indexOf("煤矿重大事故隐患判定标准") < 0, cleaned.text);
    chk("清洗后不再含进度碎片「3/20」", cleaned.text.indexOf("3/20") < 0);
    chk("清洗后不再含分值「1.0分」", cleaned.text.indexOf("1.0分") < 0);
    chk("题干本体完整保留",
      cleaned.text.indexOf("带式输送机输送带入井前应经过什么试验？") >= 0);
    chk("选项完整保留", cleaned.text.indexOf("A 强度试验") >= 0 && cleaned.text.indexOf("D 防水试验") >= 0);

    // 「A 强度试验」这种丢掉分隔符的写法必须认成选项
    chk("「A 强度试验」判为选项 opt", qLineKind("A 强度试验") === "opt", qLineKind("A 强度试验"));
    chk("「（… 3/20」判为界面碎片 meta", qLineKind("（… 3/20") === "meta", qLineKind("（… 3/20"));
    // 反向：不能把真题干误吞
    chk("「A 类火灾是指固体物质火灾。」不被误判为选项",
      qLineKind("A 类火灾是指固体物质火灾。") !== "opt", qLineKind("A 类火灾是指固体物质火灾。"));
    chk("含挖空的真题干不被当成库名行",
      cleanQueryText("根据《煤矿安全规程》的规定，下列说法正确的是（）").dropped === 0);

    // 识别自检：修前「选项 ✗（读到 0 个）」，修后应数出 A/B/C/D
    const gate = ocrGate(RAW_OCR);
    chk("识别自检数出 4 个选项", gate.optCount === 4, gate.optCount);
    chk("识别自检标号连续 A/B/C/D",
      gate.optLabels.join("/") === "A/B/C/D" && !gate.optGap,
      gate.optLabels.join("/") + (gate.optGap ? "（不连续）" : ""));
  } catch (e) {
    chk("第 16 节（输入清洗 + 选项识别）执行成功", false, (e && e.message) || String(e));
  }

  // ---------- 17. 整题检索（v1.0.63）：题干是套话时，按选项整条比对 ----------
  // 用户实测：AI 精读把题干和 4 个选项都识别对了，但搜出来的全是
  // "只是同提到刮板输送机"的题，正确那道排第 33 —— 因为题干是
  // 「下列叙述中错误的是（）」这种全库重复上千次的套话，而旧算法给
  // 选项的权重只有 0.5（＝1 分/块），压不过题干相似度的 20~40 分/块。
  try {
    const GEN_STEM = "下列叙述中错误的是（）。";
    const T_OPTS = [
      "刮板输送机司机必须与各工种相互协调好，及时开停机，做到安全生产",
      "当班出现问题，当班应当妥善处理，如果不影响生产可以留给下一班",
      "刮板输送机司机应经常检查电动机、减速器等各部分的运转声音是否正常，轴承是否过热",
      "行人通过的输送机机尾要设盖板，输送机行人跨越处要有过桥"
    ];
    const baseCat = DATA.items[0] ? DATA.items[0].cat : "";
    const baseBank = DATA.items[0] ? DATA.items[0].bankId : "default";
    const probeT = {
      id: "probe_whole_" + Date.now(), q: GEN_STEM, a: "B",
      opts: T_OPTS.map(function (t, i) { return { label: "ABCD"[i], text: t }; }),
      type: "单选题", cat: baseCat, bankId: baseBank, note: "", src: "测试", createdAt: Date.now()
    };
    // 干扰题：题干讲的是完全另一件事，只是也提到"刮板输送机"
    const probeD = {
      id: "probe_decoy_" + Date.now(), q: "827.刮板输送机运行中造成伤人的原因有（ ）。", a: "A",
      opts: [{ label: "A", text: "人被转动部分绞伤" },
             { label: "B", text: "用刮板输送机运送物料时被挤伤或撞伤" },
             { label: "C", text: "其他人误开机而造成的人身伤亡" }],
      type: "单选题", cat: baseCat, bankId: baseBank, note: "", src: "测试", createdAt: Date.now()
    };
    // 干扰题放在数组更前面：旧算法下它靠"题干词级相似"必然压过正确题
    DATA.items.unshift(probeT);
    DATA.items.unshift(probeD);

    // 模拟 AI 精读的输出：题干 + 带标号的 4 个选项
    const askText = GEN_STEM + "\\n"
      + T_OPTS.map(function (t, i) { return "ABCD"[i] + ". " + t; }).join("\\n");
    // 桥接/源码的整题识别必须认出来
    chk("整题识别：拆出 4 条选项、题干不含选项文字",
      (function () {
        if (typeof planQuestion !== "function") return false;
        const pq = planQuestion(askText);
        return pq.optTexts.length === 4 && pq.stemText.indexOf("刮板输送机") < 0;
      })());
    chk("整题识别：选项正文不含 A/B/C/D 标号",
      (function () {
        const pq = planQuestion(askText);
        return pq.optTexts.every(function (t) { return !/^[A-Ha-h]/.test(t); });
      })());

    go("search"); setSearchText(askText); doSearch();
    await new Promise(function (r) { setTimeout(r, 1600); });
    const cs = Array.prototype.slice.call(document.querySelectorAll("#searchResults .qcard"));
    chk("整题检索：有结果", cs.length > 0, cs.length);
    const firstTxt = cs[0] ? cs[0].textContent.replace(/\\s+/g, " ") : "";
    chk("整题检索：第 1 名是题干为套话的那道题（不是只同提到某个词的干扰题）",
      firstTxt.indexOf(GEN_STEM.replace("（）。", "")) >= 0, firstTxt.slice(0, 46));
    const dIdx = cs.findIndex(function (c) {
      return c.textContent.indexOf("刮板输送机运行中造成伤人的原因") >= 0;
    });
    chk("干扰题仍在结果里、但排在正确题之后", dIdx > 0, "第 " + (dIdx + 1) + " 名");

    [probeD, probeT].forEach(function (x) {
      const k = DATA.items.indexOf(x); if (k >= 0) DATA.items.splice(k, 1);
    });
    setSearchText(""); doSearch();
    await new Promise(function (r) { setTimeout(r, 400); });
  } catch (e) {
    chk("第 17 节（整题检索）执行成功", false, (e && e.message) || String(e));
  }

  /* ---------- 18. 快捷指令截图「AI 精读 → 自动搜题」（m8）---------- */
  try {
    function _mkFakeFile(){ try { return new File([new Uint8Array([1,2,3,4])], "shot.png", {type:"image/png"}); } catch(e){ return { name:"shot.png", type:"image/png" }; } }
    const _goodOcr = "2、为预防工作面漏顶事故应当采取（）。\\nA．加强支护\\nB．加强通风\\nC．加强监测\\nD．以上都是";
    const _poorOcr = "图";
    const _aiData = { type:"单选题", q:"2、为预防工作面漏顶事故应当采取（）。", opts:[{label:"A",text:"加强支护"},{label:"B",text:"加强通风"},{label:"C",text:"加强监测"},{label:"D",text:"以上都是"}], a:"D" };

    // 桩：本机 OCR 返回"达标"或"不达标"；AI 精读返回结构化；有可用模型
    const _origOcrBlocks = window.ocrLocalBlocks;
    const _origMAi = window.mAiRecognize;
    const _origGetModel = window.getActiveModel;
    const _origDoSearch = window.doSearch;
    let _fired = false;
    window.doSearch = function(){ _fired = true; };
    window.getActiveModel = function(){ return { name:"测试模型", modelName:"test" }; };
    window.mAiRecognize = function(){ return Promise.resolve({ ok:true, data:_aiData }); };

    async function _runShortcut(ocrText, autoOn){
      _fired = false;
      if (window.__SB) { window.__SB.__shortcutOcr = false; window.__SB.__shortcutOcrAuto = false; }
      const st = window.settings(); st.ocrAutoSearch = autoOn; window.saveSettings(st);
      window.ocrLocalBlocks = function(){ return Promise.resolve({ ok:true, text:ocrText, groups:[], lowBlocks:[], lowUsable:false, engine:"Umi-OCR", ms:5, blocks:5 }); };
      if (window.__SB) window.__SB.__shortcutOcr = true;   // 等价于 app-bridge 的 shot 分支
      const f = _mkFakeFile();
      await window.handleImage(f);
      await new Promise(function(r){ setTimeout(r, 900); });  // 等：AI 精读(桩) + 自动点搜题
      return _fired;
    }

    // ① 开关开 + OCR 达标 → 应自动搜题
    const firedOn = await _runShortcut(_goodOcr, true);
    chk("auto(开·达标): 截图识别达标后自动搜题", firedOn === true, "searchFired="+firedOn);
    chk("auto(开·达标): __shortcutOcr 已消费（不影响手动）", window.__SB ? window.__SB.__shortcutOcr === false : true);

    // ② 开关关 → 不打自动（退回人工点）
    const firedOff = await _runShortcut(_goodOcr, false);
    chk("auto(关): 不自动搜题（需手动点）", firedOff === false, "searchFired="+firedOff);

    // ③ 开关开 + 本地 OCR 极烂（"图"，题干<8字）→ m8 下仍自动搜：
    //    本地 OCR 不再卡自动流程，先无条件跑 AI 精读，AI 看图读准后达标即自动搜（命中第一题"本地 OCR 把选项数丢"）
    const firedPoor = await _runShortcut(_poorOcr, true);
    chk("auto(开·本地OCR极烂): AI 精读后达标仍自动搜（m8 修复）", firedPoor === true, "searchFired="+firedPoor);

    // ③b 第一题式：长题干 + 本地 OCR 把 A/B/C/D 标号数丢（optCount<2 但题干≥8字）→
    //      m7 下会被本地 gate 卡住不自动；m8 下本地 OCR 再烂也不影响，AI 精读后达标即自动搜
    const _localBadOpt = "国务院《城市更新“十五五”规划》提出要建立可持续的城市更新机制（）。\\n加强生态修复与绿地建设\\n推进老旧小区改造提升\\n完善基础设施补短板\\n强化安全管理责任落实";
    const firedBadOpt = await _runShortcut(_localBadOpt, true);
    chk("auto(开·长题干+选项标号被数丢): 仍自动搜（m8 修复，命中第一题）", firedBadOpt === true, "searchFired="+firedBadOpt);

    // 复原
    window.ocrLocalBlocks = _origOcrBlocks;
    window.mAiRecognize = _origMAi;
    window.getActiveModel = _origGetModel;
    window.doSearch = _origDoSearch;
    if (window.__SB) { window.__SB.__shortcutOcr = false; window.__SB.__shortcutOcrAuto = false; }
    const _rst = window.settings(); delete _rst.ocrAutoSearch; window.saveSettings(_rst);
  } catch (e) {
    chk("第 18 节（截图自动搜题 m7）执行成功", false, (e && e.message) || String(e));
  }

  } catch (fatal) {
    // 这里同样要写双反斜杠（见上面 RAW_OCR 的说明）
    chk("页面测试脚本未中途抛错", false,
      ((fatal && (fatal.stack || fatal.message)) || String(fatal)).split("\\n").slice(0, 4).join(" ⏎ "));
  }

  return { rows: R, errors: window.__PAGE_ERRORS || [] };
})();
`;

/* ---------------- 主流程 ---------------- */
let desktopFnCount = 0;

/* PAGE_TESTS 是模板字符串，里面必须写双反斜杠转义（\\n / \\d）。
   写单反斜杠会被模板字符串先解释成真实换行/字符，落到页面里就是
   "Uncaught SyntaxError: Invalid or unexpected token" —— 而 Electron 只会
   回一句 "Script failed to execute"，非常难查（踩过一次）。
   所以开窗口之前先在 Node 侧把页面脚本编译一遍，出错直接说清哪一行。 */
(function guardPageTestsSyntax() {
  try {
    new Function(PAGE_TESTS);
  } catch (e) {
    console.error("\n✗ PAGE_TESTS 页面侧脚本语法错误：" + ((e && e.message) || e));
    const m = /(\d+):(\d+)/.exec(String((e && e.stack) || ""));
    if (m) {
      const ln = parseInt(m[2], 10);
      PAGE_TESTS.split("\n").slice(Math.max(0, ln - 3), ln + 2)
        .forEach(function (l, i) { console.error("   " + (ln - 2 + i) + "  " + l); });
    }
    console.error("  提示：模板字符串里 \n 要写成 \\n，\\d 要写成 \\\\d\n");
    process.exit(1);
  }
})();

/* ---------------- 阶段 2：设置 / 小键值 的持久化（模拟"重启 App"） ----------------
   真机上这些是写进沙盒文件的；EV 桩用 test/_stub-persist.json 真落盘，
   然后 reload 一次页面 —— 对网页来说 reload 等价于"App 被重启后重新打开"，
   因为 iOS 上 file:// 页面的 localStorage 每次启动都是空的（这正是问题本身）。 */
const PERSIST_FILE = path.join(__dirname, "_stub-persist.json");

const SAVE_BEFORE_RESTART = `
(async function () {
  var out = { steps: [] };
  try {
    var st = settings();
    st.models = (st.models || []).concat([{
      id: "probe_model_m6", name: "探针模型", baseUrl: "https://api.example.com",
      modelName: "probe-1", apiKey: "sk-probe-key", default: true
    }]);
    st.activeModelId = "probe_model_m6";
    saveSettings(st);
    out.steps.push("saved-settings");

    localStorage.setItem("souti_typo_user", JSON.stringify([["士", "土"]]));
    localStorage.setItem("souti_mBank", "我的题库A");
    /* 这两个键不该被镜像：题库数据走 data.json、设置走 settings.json，
       一个东西只有一个家，别再存一份（题库那份 8MB 级）。 */
    localStorage.setItem("wb_searchbank_v1", "SHOULD_NOT_BE_MIRRORED");
    localStorage.setItem("wb_searchbank_settings", "SHOULD_NOT_BE_MIRRORED");

    // 真机是防抖 400ms 后自动落盘，测试不等这么久，手动催一次
    window.__SB.__test.lsFlush();
    await new Promise(function (r) { setTimeout(r, 600); });
    out.lsReady = window.__SB.__test.isLsReady();

    /* 真机关键点：iOS 上 file:// 的 localStorage 只在内存里，App 一关就空了。
       Electron 恰恰相反（会落盘），所以必须手动清空才能复现"重启"，
       否则下面的"恢复"是假通过。清空前先停掉落盘，
       免得防抖窗口里那一次把空快照写回镜像、把刚存的东西抹掉。 */
    window.__SB.__test.pauseLsFlush();
    try { localStorage.clear(); } catch (e) {}
    out.cleared = localStorage.length;
    out.ok = true;
  } catch (e) { out.ok = false; out.error = String(e && (e.message || e)); }
  return JSON.stringify(out);
})()
`;

const VERIFY_AFTER_RESTART = `
(function () {
  var out = {};
  try {
    var st = settings();
    var m = (st.models || []).filter(function (x) { return x.id === "probe_model_m6"; });
    out.modelsTotal = (st.models || []).length;
    out.found = m.length;
    out.name = m[0] && m[0].name;
    out.apiKey = m[0] && m[0].apiKey;
    out.active = st.activeModelId;
    out.typo = localStorage.getItem("souti_typo_user");
    out.mBank = localStorage.getItem("souti_mBank");
    out.ok = true;
  } catch (e) { out.ok = false; out.error = String(e && (e.message || e)); }
  return JSON.stringify(out);
})()
`;

/* 这两个字符串也是页面侧脚本，一并做语法自检（同 PAGE_TESTS 的教训） */
[["SAVE_BEFORE_RESTART", SAVE_BEFORE_RESTART], ["VERIFY_AFTER_RESTART", VERIFY_AFTER_RESTART]]
  .forEach(function (pair) {
    try { new Function(pair[1]); }
    catch (e) {
      console.error("\n✗ " + pair[0] + " 语法错误：" + ((e && e.message) || e));
      process.exit(1);
    }
  });

/* 每轮开跑前删掉持久化文件，保证从"全新安装"开始，结果可复现 */
try { fs.unlinkSync(PERSIST_FILE); } catch (e) {}

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
      webSecurity: false,
      /* Electron 31 起 preload 默认跑在 sandbox 里 → 拿不到 require("fs")，
         持久化桩就没法真的落盘，"重启后还在不在"根本测不出来。
         真机不存在这个问题（原生 Swift 直接写文件），这里为了测必须关掉。 */
      sandbox: false
    }
  });

  const consoleErrors = [];
  let consoleErrMark = 0;   // 阶段 2 只看 reload 之后新增的报错
  win.webContents.on("console-message", function (a, b, c) {
    // Electron 新旧两种回调签名都兼容
    const level = (b && typeof b === "object") ? b.level : b;
    const message = (b && typeof b === "object") ? b.message : c;
    const isErr = (level === 3) || (level === "error");
    if (isErr) consoleErrors.push(String(message));
  });

  let loadPhase = 0;

  win.webContents.on("did-finish-load", function () {
    loadPhase++;
    if (loadPhase === 1) {
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

            runSavePhase();
          })
          .catch(function (err) {
            chk("页面测试脚本本身执行成功", false, err && err.message);
            finish();
          });
      }, 500);
      return;
    }

    // 第二次 did-finish-load = reload 之后（等价于"重启 App 再打开"）
    setTimeout(function () {
      win.webContents
        .executeJavaScript(VERIFY_AFTER_RESTART, true)
        .then(function (raw) {
          const v = JSON.parse(raw);
          chk("重启后：页面脚本正常初始化", v.ok === true, v.error || "");
          chk("重启后：AI 模型还在（设置真的落到沙盒文件了）",
            v.found === 1, "找到 " + v.found + " 条 / 共 " + v.modelsTotal + " 条");
          chk("重启后：模型名与密钥完好",
            v.name === "探针模型" && v.apiKey === "sk-probe-key", (v.name || "") + " / " + (v.apiKey || ""));
          chk("重启后：默认模型标记保留", v.active === "probe_model_m6", String(v.active));
          chk("重启后：纠错词典（走 localStorage 镜像）也恢复了",
            v.typo === JSON.stringify([["士", "土"]]), String(v.typo));
          chk("重启后：上次选的题库（小键值）也恢复了",
            v.mBank === "我的题库A", String(v.mBank));
          const errsAfter = consoleErrors.slice(consoleErrMark);
          chk("重启后：控制台无 error 级输出", errsAfter.length === 0,
            errsAfter.length ? errsAfter.slice(0, 3).join(" | ") : "无");
          finish();
        })
        .catch(function (err) {
          chk("重启后：页面脚本执行成功", false, err && err.message);
          finish();
        });
    }, 1400);
  });

  /* 阶段 2 第一步：按网页真实入口存一条 AI 模型 + 一个"小键值"，
     然后从 Node 侧直接看落盘文件，确认原生真的写进去了。 */
  function runSavePhase() {
    win.webContents
      .executeJavaScript(SAVE_BEFORE_RESTART, true)
      .then(function (raw) {
        const r = JSON.parse(raw);
        chk("阶段2：走网页真实入口保存设置", r.ok === true, r.error || (r.steps || []).join(","));
        chk("阶段2：localStorage 镜像已就绪（isLsReady）", r.lsReady === true, String(r.lsReady));
        chk("阶段2：已模拟 iOS 的内存 localStorage 被清空", r.cleared === 0, "剩余 " + r.cleared + " 个键");

        let store = {};
        try { store = JSON.parse(fs.readFileSync(PERSIST_FILE, "utf8")); } catch (e) {}
        chk("阶段2：沙盒 settings.json 里确实有这条模型（原生写入成功）",
          typeof store.settings === "string" && store.settings.indexOf("probe_model_m6") >= 0,
          (store.settings || "").length + " 字节");
        const kv = store.kv || {};
        chk("阶段2：小键值已镜像到原生",
          typeof kv["__ls_mirror_souti_typo_user"] === "string",
          String(kv["__ls_mirror_souti_typo_user"]));
        chk("阶段2：题库数据键未被镜像", kv["__ls_mirror_wb_searchbank_v1"] === undefined);
        chk("阶段2：设置键未被镜像", kv["__ls_mirror_wb_searchbank_settings"] === undefined);

        // 模拟重启
        consoleErrMark = consoleErrors.length;
        win.webContents.reload();
      })
      .catch(function (err) {
        chk("阶段2：保存与镜像执行成功", false, err && err.message);
        finish();
      });
  }

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
