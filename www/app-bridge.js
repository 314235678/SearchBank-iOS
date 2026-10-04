/* =====================================================================
 * 搜题平台 · iOS 桥接层 v3.0（对应网页 v1.0.61）
 * ---------------------------------------------------------------------
 * 目标：让「电脑版 v1.0.61」的网页代码在 iOS 上**原样跑起来**，不再维护
 *       一份功能落后的手机专用网页。
 *
 * 做法：网页里所有“只有 Electron 才有的东西”都用 JS 在这里补齐 ——
 *   网页侧引用            本桥接层映射到
 *   window.fsBridge    →  __SB.loadData / saveData        （沙盒 data.json）
 *   window.umiBridge   →  __SB.ocrBlocks                  （iOS Vision 离线 OCR）
 *   window.aiBridge    →  __SB.aiAsk / aiProof / aiRecognize / aiChat
 *   window.batchBridge →  选不到文件夹 → 降级为“相册选图”
 *   window.wpsBridge   →  iOS 没有 WPS → 一律走系统分享面板
 *
 * 加载时机：必须在网页主体 <script> **之前**执行（网页里
 *   `const desktopFS = window.fsBridge || null` 是同步求值的）。
 *   由 build_www.js 插在主体 <script> 前面。
 * ===================================================================== */
(function () {
  "use strict";

  /* ==================================================================
   * 0. 原生通道
   * ================================================================== */
  var handler =
    window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.bridge;
  var native = !!handler;

  var pending = {};
  var seq = 0;

  function post(type, payload) {
    return new Promise(function (resolve) {
      if (!handler) {
        resolve({ error: "native bridge unavailable" });
        return;
      }
      var id = "m" + ++seq;
      pending[id] = resolve;
      try {
        handler.postMessage({ id: id, type: type, payload: payload || null });
      } catch (e) {
        delete pending[id];
        resolve({ error: (e && e.message) || String(e) });
      }
    });
  }

  window.__SB = window.__SB || {};
  window.__SB.native = native;
  window.__SB.__onNative = function (id, result) {
    var r = pending[id];
    if (r) {
      delete pending[id];
      r(result || {});
    }
  };

  /* ---- 小工具 ---- */
  function dataURLtoBlob(url) {
    var parts = String(url || "").split(",");
    if (parts.length < 2) return null;
    var mime = (/:(.*?);/.exec(parts[0]) || [, "image/jpeg"])[1];
    try {
      var bin = atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch (e) {
      return null;
    }
  }
  function dataURLtoFile(url, name) {
    var b = dataURLtoBlob(url);
    if (!b) return null;
    return new File([b], name || "image.jpg", { type: b.type });
  }
  function readAsDataURL(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result || "")); };
      fr.onerror = function () { rej(new Error("读取图片失败")); };
      fr.readAsDataURL(file);
    });
  }
  function decodeB64(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    try {
      return new TextDecoder("utf-8").decode(arr);
    } catch (e) {
      return decodeURIComponent(escape(bin));
    }
  }

  /* ==================================================================
   * 1. 原生能力封装（__SB.*）
   * ================================================================== */
  window.__SB.ocr = function (base64) {
    return post("ocr", { base64: base64 }).then(function (r) {
      if (r.error) throw new Error(r.error);
      return r.text || "";
    });
  };

  /* v3.0 新增：带坐标与置信度的离线 OCR。
     网页 v1.0.61 的「按坐标重排 + 低分块标黄」全靠这个 ——
     Vision 本身就能给出 boundingBox 与 confidence，只是以前没往外取。
     返回 {blocks, w, h}；w/h 是处理后图幅，桥接层判"贴边 UI"要用。 */
  window.__SB.ocrBlocks = function (base64) {
    return post("ocrBlocks", { base64: base64 }).then(function (r) {
      if (r.error) throw new Error(r.error);
      return {
        blocks: r.blocks || [],
        w: r.w || 0, h: r.h || 0,
        // 坐标映射：原图坐标 = (处理后坐标 + 顶部裁掉的像素) / 缩放比
        scale: r.scale || 1,
        cropTop: r.cropTop || 0,
        cropBottom: r.cropBottom || 0,
        ow: r.ow || 0, oh: r.oh || 0
      };
    });
  };

  window.__SB.pickFiles = function () {
    return post("pickFiles", {}).then(function (r) {
      if (r.error) throw new Error(r.error);
      return r.files || [];
    });
  };

  window.__SB.shareExport = function (text, filename) {
    return post("shareExport", { text: text, filename: filename }).then(function (r) {
      if (r && r.error) throw new Error(r.error);
      return true;
    });
  };

  /* 二进制（docx）分享：payload 为 base64 */
  window.__SB.shareBinary = function (base64, filename, mime) {
    return post("shareBinary", {
      base64: base64, filename: filename, mime: mime || ""
    }).then(function (r) {
      if (r && r.error) throw new Error(r.error);
      return true;
    });
  };

  window.__SB.getBundledBank = function () {
    return post("getBundledBank", {}).then(function (r) {
      if (r.error) throw new Error(r.error);
      return r.text || "";
    });
  };

  window.__SB.loadData = function () {
    return post("loadData", {}).then(function (r) {
      return r && typeof r.text === "string" ? r.text : "";
    });
  };
  window.__SB.saveData = function (text) {
    return post("saveData", { text: text }).then(function (r) {
      return !(r && r.error);
    });
  };
  window.__SB.dataPath = function () {
    return post("dataPath", {}).then(function (r) { return (r && r.path) || ""; });
  };

  window.__SB.captureImage = function () {
    return post("captureImage", {}).then(function (r) {
      if (r && r.error) throw new Error(r.error);
      return (r && r.dataUrl) || "";
    });
  };
  window.__SB.pickImage = function () {
    return post("pickImage", {}).then(function (r) {
      if (r && r.error) throw new Error(r.error);
      return (r && r.dataUrl) || "";
    });
  };
  window.__SB.pickLatestPhoto = function () {
    return post("pickLatestPhoto", {}).then(function (r) {
      if (r && r.error) throw new Error(r.error);
      return (r && r.dataUrl) || "";
    });
  };

  window.__SB.processURL = function (params) {
    return post("processURL", { params: params || {} }).then(function (r) {
      return !(r && r.error);
    });
  };

  window.__SB.setSetting = function (key, value) {
    return post("setSetting", { key: String(key || ""), value: value }).then(function (r) {
      return !(r && r.error);
    });
  };
  window.__SB.getSetting = function (key) {
    return post("getSetting", { key: String(key || "") }).then(function (r) {
      return r ? r.value : null;
    });
  };

  window.__SB.readClipboard = function () {
    return post("readClipboard", {}).then(function (r) {
      return (r && r.text) || "";
    });
  };
  window.__SB.writeClipboard = function (text) {
    return post("writeClipboard", { text: text }).then(function (r) {
      return !(r && r.error);
    });
  };

  window.__SB.openExternal = function (url) {
    return post("openExternal", { url: url }).then(function (r) {
      return !(r && r.error);
    });
  };

  /* ---- AI（走原生 URLSession） ---- */
  window.__SB.aiAsk = function (opts) { return post("aiAsk", opts || {}); };
  window.__SB.aiProof = function (opts) { return post("aiProof", opts || {}); };
  window.__SB.aiRecognize = function (opts) { return post("aiRecognize", opts || {}); };
  window.__SB.aiChat = function (opts) { return post("aiChat", opts || {}); };

  /* ==================================================================
   * 2. fsBridge —— 网页的数据持久化
   *    网页语义：readData() → {items,banks,...}；writeData(obj) 落盘
   *    落到 iOS：Documents/SearchBank/data.json（与旧版格式完全一致）
   * ================================================================== */
  window.fsBridge = {
    readData: function () {
      return window.__SB.loadData().then(function (t) {
        if (!t) return null;
        try { return JSON.parse(t); } catch (e) { return null; }
      }).catch(function () { return null; });
    },
    writeData: function (data) {
      var text;
      try {
        text = JSON.stringify(data);
      } catch (e) {
        return Promise.resolve({ ok: false, error: "序列化失败：" + ((e && e.message) || e) });
      }
      return window.__SB.saveData(text).then(function (ok) {
        return ok ? { ok: true } : { ok: false, error: "写入失败" };
      }).catch(function (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      });
    },
    dataDir: function () { return window.__SB.dataPath(); },
    dataFilePath: function () { return window.__SB.dataPath(); },

    migrateFile: function () {
      return window.__SB.pickFiles().then(function (files) {
        var f = (files || []).filter(function (x) {
          return /\.json$/i.test(x.name || "");
        })[0];
        if (!f) return { ok: false, canceled: true };
        var txt = decodeB64(f.data);
        if (typeof window.ingestBackup === "function") {
          window.ingestBackup(txt);
          return { ok: true, count: 0 };
        }
        return { ok: false, error: "当前页面不支持该导入方式" };
      }).catch(function (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      });
    },
    chooseDataDir: function () {
      return Promise.resolve({
        ok: false,
        error: "iOS 上数据固定保存在 App 沙盒（文件 App → 我的 iPhone → 搜题平台）"
      });
    },
    resetDataDir: function () { return Promise.resolve({ ok: true }); },
    openDataDir: function () {
      toast("数据文件位置：文件 App → 我的 iPhone → 搜题平台");
      return Promise.resolve({ ok: false });
    },

    /* 设置：iOS 上没有独立 settings.json，用 localStorage 镜像即可。
       返回镜像内容 —— 首次为空对象，网页保持它自己的 localStorage 设置；
       之后两者一致，merge 幂等。 */
    readSettings: function () {
      try {
        var t = localStorage.getItem("sb_settings_mirror");
        return Promise.resolve(t ? JSON.parse(t) : {});
      } catch (e) { return Promise.resolve({}); }
    },
    writeSettings: function (s) {
      try { localStorage.setItem("sb_settings_mirror", JSON.stringify(s || {})); } catch (e) {}
      return Promise.resolve({ ok: true });
    }
  };

  /* ==================================================================
   * 3. umiBridge —— 离线 OCR（iOS Vision）
   *    网页 v1.0.61 的 ocrLocalBlocks() 要求：
   *      init()        → {ok:true}
   *      ocr(dataURL)  → {ok:true, data:[{text, box:[[x,y]×4], score}]}
   * ================================================================== */
  var _clipTimer = null;
  var _clipCbs = [];
  var _lastClip = "";

  /* ==================================================================
   * 3.0 整页截图净化（Full-page sanitize）
   * ----------------------------------------------------------------
   * 手机截图是**整屏**的：状态栏、App 导航栏、按钮、答题卡、页码、
   * 其它题的残留全在里面。直接把这些喂给搜索，等于拿一屏界面文字去搜
   * 一道题，结果必然偏。这里用识别坐标做版面分析，只保留「题目主体」。
   *
   * 三条铁律 —— 全是旧手机版 v2.7→v2.20 一轮轮踩出来的，别再犯：
   *   ① 绝不因为「这行没有标点 / 没有数字 / 不匹配某个 \W」就删。
   *      v2.19 就是被 /^\s*[\W_]+\s*$/ 坑的：JS 的 \W 不认汉字，于是
   *      「可计算的」这类**纯中文题干行**被整行删掉，提炼结果只剩 ABCD。
   *   ② 题型标签（单选/多选/判断题）只在**独立成行**时才算噪声；
   *      「单选 2、为预防工作面两端发生漏顶…」这种带题干的绝对不能删（v2.7）。
   *   ③ 拿不准就保留。宁可多留一行界面文字，也绝不能吃掉题干。
   * ================================================================== */

  /* 界面词表：注意判定方式不是"行里出现就删"，而是
     "整行几乎只由这些词组成"才算 UI 行。否则「下列关于考试的说法」这种
     题干会被误杀。 */
  var UI_STRONG = [
    "答题卡", "答案解析", "正确答案是", "您的回答", "我的答案", "上一题", "下一题",
    "交卷", "返回", "收藏", "分享", "关注公众号", "扫一扫", "扫码", "下载",
    "客服", "错题", "重做", "批改", "查看答案", "继续答题", "每日一测", "考试复习",
    "学习强企", "开始答题", "提交答案", "确认交卷", "题目解析", "AI解析", "视频解析",
    "问老师", "纠错", "点赞", "评论", "首页", "课程", "模考", "历年真题",
    "智能组卷", "章节练习", "模拟考试", "倒计时", "已用时", "已做题", "背题",
    "语音", "搜题", "更多资料", "答题结果", "限时", "展开全部", "全部题目"
  ];

  /* 纯数字/时间/电量/进度：整行就这些内容才删 */
  var RE_UI_NUM = /^\s*(\d{1,2}\s*[:：]\s*\d{2}(\s*[:：]\s*\d{2})?|\d{1,3}\s*%|5G|4G|LTE|WiFi|WLAN|\d{1,3}\s*\/\s*\d{1,3}|\d{1,4})\s*$/i;
  /* 纯符号行（不含汉字/字母/数字）—— 注意 character class 里显式带了 \u4e00-\u9fa5，
     这正是 v2.19 的补丁，别再写 \W */
  var RE_UI_SYM = /^\s*[^\u4e00-\u9fa5A-Za-z0-9_\s]+\s*$/;
  var RE_NOISE = [
    /^https?:\/\//i,
    /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
    /^第\s*\d+\s*[页题]/,
    /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/
  ];

  /* 标号分隔符：必须把**全角**的都算进来。
     实测漏了全角句点 U+FF0E「．」会出大事 —— Vision 输出的选项就是
     「A．加强支护」，漏了它 → 选项行判不出类型 → 尾部裁剪把题干续行一起切掉。 */
  var SEP = "[.．、,，:：]";
  var RE_QNO = new RegExp("^\\s*\\d{1,3}\\s*" + SEP + "\\s*\\S");
  var RE_OPT = new RegExp("^\\s*[A-Da-d]\\s*[.．、,，:：)）]\\s*\\S");
  var RE_OPT2 = /^\s*[A-Da-d]\s+[^\s]/;
  var RE_ANS = /(正确答案|参考答案|答案)\s*[:：=]/;
  var RE_STEM_HINT = /(下列|关于|请|以下|哪一|不属|属于|说法|表述|指出|根据|依据|符合|正确的|错误的|是指|包括|属于下列)/;
  var RE_TYPE_LABEL = /^\s*(单选|多选|判断|填空|简答|不定项|材料|案例)(题|选择题)?\s*\d{0,3}\s*[.．、:：]?\s*$/;

  /* 状态栏 / 进度条那一行：把时间、电量、网络、X/Y 进度都抠掉后，
     如果什么都不剩（或只剩数字），那整行就是系统 UI。
     比 RE_UI_NUM 宽容 —— "18:37 5G" 这种一行塞好几个信息的也认得出来。 */
  function looksLikeStatusRow(t) {
    var bare = String(t || "").replace(/\s+/g, "");
    if (!bare || bare.length > 14) return false;
    var left = String(t || "")
      .replace(/\d{1,2}\s*[:：]\s*\d{2}(\s*[:：]\s*\d{2})?/g, "")
      .replace(/\d{1,3}\s*%/g, "")
      .replace(/(5G|4G|LTE|VoLTE|WiFi|WLAN|HD)\b/gi, "")
      .replace(/\d{1,3}\s*\/\s*\d{1,3}/g, "")
      .replace(/[\s\u3000|·•.．。、,，:：!！?？\-—_+\/\\()（）\[\]【】<>《》]/g, "");
    return left.length <= 1;
  }

  function rowText(items) {
    var s = "", prevEnd = null;
    items.forEach(function (it) {
      if (prevEnd !== null && it.x - prevEnd > 60) s += " ";
      s += it.text;
      prevEnd = it.x2;
    });
    return s;
  }

  /* 把 blocks 按纵坐标分组成"行"——与桌面 sortOcrBlocks 同款参数 */
  function rowGroupBlocks(blocks) {
    var rows = [];
    (blocks || []).forEach(function (d, i) {
      if (!d) return;
      var t = String(d.text || "");
      if (!t.trim()) return;
      var xs = [], ys = [];
      var b = d.box;
      if (Array.isArray(b) && b.length) {
        if (Array.isArray(b[0])) {
          b.forEach(function (p) { if (p && p.length >= 2) { xs.push(+p[0]); ys.push(+p[1]); } });
        } else {
          for (var k = 0; k + 1 < b.length; k += 2) { xs.push(+b[k]); ys.push(+b[k + 1]); }
        }
      }
      rows.push({
        text: t,
        score: (typeof d.score === "number") ? d.score : null,
        y: ys.length ? Math.min.apply(null, ys) : i * 10,
        yBot: ys.length ? Math.max.apply(null, ys) : i * 10,
        x: xs.length ? Math.min.apply(null, xs) : 0,
        x2: xs.length ? Math.max.apply(null, xs) : 0,
        h: ys.length ? (Math.max.apply(null, ys) - Math.min.apply(null, ys)) : 0,
        items: [{
          text: t,
          score: (typeof d.score === "number") ? d.score : null,
          x: xs.length ? Math.min.apply(null, xs) : 0,
          x2: xs.length ? Math.max.apply(null, xs) : 0,
          y: ys.length ? Math.min.apply(null, ys) : 0
        }]
      });
    });
    if (!rows.length) return [];
    var hs = rows.map(function (r) { return r.h; }).filter(function (v) { return v > 0; })
      .sort(function (a, b) { return a - b; });
    var medH = hs.length ? hs[Math.floor(hs.length / 2)] : 12;
    var tol = Math.max(5, medH * 0.55);
    rows.sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });

    var groups = [];
    rows.forEach(function (r) {
      var g = groups[groups.length - 1];
      if (g && (r.y - g.y) <= tol) {
        g.items.push(r.items[0]);
        g.y = Math.min(g.y, r.y);
        g.yBot = Math.max(g.yBot, r.yBot);
        g.x = Math.min(g.x, r.x);
        g.x2 = Math.max(g.x2, r.x2);
      } else {
        groups.push({
          y: r.y, yBot: r.yBot, x: r.x, x2: r.x2, items: [r.items[0]]
        });
      }
    });
    groups.forEach(function (g) {
      g.items.sort(function (a, b) { return a.x - b.x; });
      // 关键：把同行的块拼成整行文字 —— classifyRow / looksLikeUIRow 都靠它
      g.text = rowText(g.items);
    });
    return groups;
  }

  /* 整行是否"几乎只由界面词构成"。返回 {ui:bool, why:string} */
  function looksLikeUIRow(text) {
    var raw = String(text || "");
    var t = raw.trim();
    if (!t) return { ui: true, why: "空行" };
    if (RE_UI_SYM.test(t)) return { ui: true, why: "纯符号" };
    if (RE_UI_NUM.test(t)) return { ui: true, why: "时间/电量/页码" };
    if (looksLikeStatusRow(t)) return { ui: true, why: "状态栏/进度" };
    // 题型标签（单选/多选/判断题）**独立成行**时才算界面文字；
    // 「单选 2、为预防…」这种带题号的整行不是，绝不能删（v2.7 教训）
    if (RE_TYPE_LABEL.test(t)) return { ui: true, why: "题型标签独立成行" };
    for (var n = 0; n < RE_NOISE.length; n++) {
      if (RE_NOISE[n].test(t)) return { ui: true, why: "链接/日期等" };
    }
    // 整行只由界面词组成（去掉界面词后剩不下什么）才判 UI
    var compact = t.replace(/[\s\u3000|·•.．。、,，:：!！?？\-—_/\\()（）\[\]【】<>《》"']/g, "");
    if (compact.length > 0 && compact.length <= 10) {
      var matched = false, left = compact;
      for (var i = 0; i < UI_STRONG.length; i++) {
        if (left.indexOf(UI_STRONG[i]) >= 0) {
          matched = true;
          left = left.split(UI_STRONG[i]).join("");
        }
      }
      // 剩料 <=1 个字符，或只剩数字（如「考试复习2/10」剥掉界面词后剩 210）
      // → 整行都是界面内容。题干剥完界面词一定会剩汉字，不会被误杀。
      if (matched && (left.length <= 1 || /^[0-9]+$/.test(left))) {
        return { ui: true, why: "界面词整行：" + t.slice(0, 10) };
      }
    }
    return { ui: false, why: "" };
  }

  /* 逐行判类型 */
  function classifyRow(row) {
    var t = String(row.text || "").trim();
    var compact = t.replace(/\s+/g, "");
    var kind = "other";
    if (RE_QNO.test(t)) kind = "stem";
    else if (RE_ANS.test(t)) kind = "ans";
    else if (RE_OPT.test(t) || RE_OPT2.test(t)) kind = "opt";
    else if (RE_STEM_HINT.test(t) && compact.length >= 6) kind = "stem";
    else if (RE_TYPE_LABEL.test(t)) kind = "label";
    else if (compact.length >= 12) kind = "stem";
    return kind;
  }

  /**
   * 整页版净化。
   * @returns {kept: blocks, stats: {...}}
   */
  function sanitizePage(res) {
    var blocks = (res && res.blocks) || [];
    var W = (res && res.w) || 0;
    var H = (res && res.h) || 0;
    var rows = rowGroupBlocks(blocks);
    var stats = {
      applied: false, totalRows: rows.length, keptRows: 0, droppedRows: 0,
      dropped: [], fallback: false, multiQ: 0
    };
    if (!rows.length) return { blocks: blocks, stats: stats, plainRows: [] };

    // 1) 逐行打标
    rows.forEach(function (r) {
      r.kind = classifyRow(r);
      var ui = looksLikeUIRow(r.text);
      r.isUI = ui.ui;
      r.uiWhy = ui.why;
      // 题型标签（单选/多选…）只在独立成行时算噪声
      if (r.kind === "label") { r.isUI = true; r.uiWhy = "题型标签独立成行"; }
    });

    // 2) 全局剔掉"确定是界面"的行
    var kept = rows.filter(function (r) { return !r.isUI; });
    rows.forEach(function (r) {
      if (r.isUI) stats.dropped.push({ text: r.text.slice(0, 24), why: r.uiWhy });
    });

    // 3) 主体定位：从第一个"题干/选项"行开始
    var medH = 0;
    (function () {
      var hs = rows.map(function (r) { return r.yBot - r.y; })
        .filter(function (v) { return v > 0; })
        .sort(function (a, b) { return a - b; });
      medH = hs.length ? hs[Math.floor(hs.length / 2)] : 12;
    })();

    var anchor = -1;
    for (var i = 0; i < kept.length; i++) {
      if (kept[i].kind === "stem" || kept[i].kind === "opt") { anchor = i; break; }
    }

    var preTrim = kept.length;
    if (anchor >= 0) {
      var start = anchor;
      if (start > 0 && kept[start - 1].kind === "label") start -= 1;
      /* 尾部**不靠"找到最后一个选项"来截** —— 选项格式千奇百怪，一旦某一行没被认成
         选项，就会连题干续行一起切掉（第一版就是这么错的）。改成按**版面间隙**判断：
         从题干往下收，一旦出现明显大于正常行距的空档、且下面那行又很短，
         就说明已经出到题目卡外面了（底部工具栏 / 底部导航）。 */
      var body = [];
      for (var k = start; k < kept.length; k++) {
        if (body.length) {
          var prev = body[body.length - 1];
          var gap = kept[k].y - prev.yBot;
          var compactLen = String(kept[k].text || "").replace(/\s+/g, "").length;
          if (gap > medH * 2.5 && compactLen <= 10) break;
        }
        body.push(kept[k]);
      }
      kept = body.length ? body : kept.slice(start);
      stats.applied = true;
    }
    stats.trimmed = preTrim - kept.length;

    var keptChars = kept.reduce(function (n, r) {
      return n + String(r.text || "").replace(/\s+/g, "").length;
    }, 0);

    // 4) 安全网：万一裁过头（题干没剩几个字），退回"只删确定界面行"的保守结果
    if (keptChars < 6 || kept.length === 0) {
      kept = rows.filter(function (r) { return !r.isUI; });
      stats.applied = false;
      stats.fallback = true;
      stats.dropped = stats.dropped.filter(function (d) { return true; });
    }

    stats.keptRows = kept.length;
    stats.droppedRows = rows.length - kept.length;

    // 5) 顺带数一下像有几道题（多题长截图）
    var qn = 0;
    kept.forEach(function (r) { if (r.kind === "stem" && RE_QNO.test(String(r.text).trim())) qn++; });
    stats.multiQ = qn;

    /* 5.5) 题目区包围盒 —— 这是"只把题目发给 AI"的关键输入。
       先算处理后坐标下的框，再用 scale / cropTop 换算回**原图**坐标，
       桥接层拿这个框去裁原图，裁出来的就是"只有题目"的小图。 */
    var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    kept.forEach(function (r) {
      if (typeof r.x === "number") bx0 = Math.min(bx0, r.x);
      if (typeof r.x2 === "number") bx1 = Math.max(bx1, r.x2);
      if (typeof r.y === "number") by0 = Math.min(by0, r.y);
      if (typeof r.yBot === "number") by1 = Math.max(by1, r.yBot);
    });
    var origBox = null;
    if (kept.length >= 3 && isFinite(bx0) && isFinite(by0) && isFinite(bx1) && isFinite(by1)) {
      var sc = (res && res.scale) || 1;
      var ct = (res && res.cropTop) || 0;
      origBox = { x0: bx0 / sc, y0: (by0 + ct) / sc, x1: bx1 / sc, y1: (by1 + ct) / sc };
      // 合理性校验：太窄（多半定位错了）或几乎覆盖整图（等于没裁）就不用
      var oW = (res && res.ow) || 0, oH = (res && res.oh) || 0;
      if (oW > 0 && oH > 0) {
        var bw = origBox.x1 - origBox.x0, bh = origBox.y1 - origBox.y0;
        if (bw < oW * 0.25 || bh < oH * 0.02 || (bw * bh) > oW * oH * 0.97) origBox = null;
      }
      if (origBox && (origBox.x1 - origBox.x0) >= (origBox.y1 - origBox.y0) * 40) origBox = null;
    }
    stats.origBox = origBox;
    stats.keptChars = keptChars;

    // 6) 还原成 blocks（保持原 box 坐标，网页还要用它做重排）
    var out = [];
    var keepSet = [];
    kept.forEach(function (r) { r.items.forEach(function (it) { keepSet.push(it); }); });
    // 用对象同一性把原文块捞回来；rowGroup 里 items 是新对象，这里按 (x,y,text) 匹配
    var used = {};
    keepSet.forEach(function (it) {
      for (var k = 0; k < blocks.length; k++) {
        if (used[k]) continue;
        var b = blocks[k];
        if (!b) continue;
        if (String(b.text || "") !== it.text) continue;
        var xs = [], ys = [];
        var bb = b.box;
        if (Array.isArray(bb) && bb.length) {
          if (Array.isArray(bb[0])) bb.forEach(function (p) { xs.push(+p[0]); ys.push(+p[1]); });
          else for (var m = 0; m + 1 < bb.length; m += 2) { xs.push(+bb[m]); ys.push(+bb[m + 1]); }
        }
        var bx = xs.length ? Math.min.apply(null, xs) : 0;
        var by = ys.length ? Math.min.apply(null, ys) : 0;
        if (Math.abs(bx - it.x) < 2 && Math.abs(by - it.y) < 2) {
          used[k] = true;
          out.push(b);
          break;
        }
      }
    });
    if (!out.length) out = blocks;

    stats.w = W; stats.h = H;
    window.__SB.__lastSanitize = stats;
    return { blocks: out, stats: stats, plainRows: kept };
  }

  /* 净化开关（默认开）—— 用户可在图片识别页一键切换 */
  function cleanOn() {
    try { return localStorage.getItem("sb_ocr_page_clean") !== "0"; } catch (e) { return true; }
  }
  function setCleanOn(v) {
    try { localStorage.setItem("sb_ocr_page_clean", v ? "1" : "0"); } catch (e) {}
  }

  window.umiBridge = {
    findEngine: function () {
      return Promise.resolve({ ok: true, path: "iOS Vision（系统内置，离线）" });
    },
    init: function () {
      return Promise.resolve({ ok: true });
    },
    ocr: function (dataURL) {
      return window.__SB.ocrBlocks(dataURL).then(function (res) {
        var blocks = res.blocks || [];
        if (!blocks.length) return { ok: false, error: "没识别到文字" };

        var out = blocks, stats = null, keptText = "";
        if (cleanOn()) {
          try {
            var s = sanitizePage(res);
            out = s.blocks;
            stats = s.stats;
            keptText = s.plainRows.map(function (r) { return r.text; }).join("\n");
          } catch (e) {
            console.warn("[bridge] 整页净化异常，退回原始结果：", e);
          }
        } else {
          // 关掉净化时也得算一次题目区，AI 裁剪要用
          try {
            var s2 = sanitizePage(res);
            stats = s2.stats;
            keptText = s2.plainRows.map(function (r) { return r.text; }).join("\n");
          } catch (e) {}
        }

        // 记下来：这一张图的题目区包围盒，供「发给 AI 前先裁一下」使用
        window.__SB.__lastLocalOCR = {
          ts: Date.now(),
          stats: stats,
          origBox: stats && stats.origBox,
          raw: blocks,
          kept: out,
          keptText: keptText
        };
        if (stats) {
          stats.engine = "iOS Vision";
          stats.blocksRaw = blocks.length;
          stats.blocksKept = out.length;
        }
        showCleanInfo(stats);
        return { ok: true, data: out };
      }).catch(function (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      });
    },
    recLine: function (dataURL) {
      return window.__SB.ocr(dataURL).then(function (t) { return { ok: true, text: t }; });
    },
    recLines: function (list) {
      return Promise.all((list || []).map(function (u) {
        return window.__SB.ocr(u).then(function (t) { return { ok: true, text: t }; })
          .catch(function () { return { ok: false, text: "" }; });
      })).then(function (r) { return { ok: true, list: r }; });
    },
    recAvailable: function () { return Promise.resolve({ ok: true }); },
    exit: function () { return Promise.resolve({ ok: true }); },

    /* iOS 无法程序化截取整屏 → 改为取相册里最新一张（就是刚截的屏）。
       用户习惯：截屏 → 回 App 点这个按钮。 */
    captureScreen: function () {
      return window.__SB.pickLatestPhoto().then(function (dataUrl) {
        if (!dataUrl) return { ok: false, error: "已取消", canceled: true };
        return { ok: true, dataURL: dataUrl, width: 0, height: 0 };
      }).catch(function (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      });
    },

    launchGui: function () {
      toast("iOS 上不需要外部 OCR 程序 —— 识别由系统离线完成");
      return Promise.resolve({ ok: false });
    },

    /* 剪贴板监听：iOS 没有全局剪贴板事件，用轮询原生剪贴板实现。
       在别的 App 里拷贝题干 → 回到搜题平台自动填入并搜索。 */
    startClipboardWatch: function () {
      if (_clipTimer) return Promise.resolve({ ok: true });
      window.__SB.readClipboard().then(function (t) { _lastClip = t || ""; });
      _clipTimer = setInterval(function () {
        window.__SB.readClipboard().then(function (t) {
          t = (t || "").trim();
          if (!t || t === _lastClip) return;
          _lastClip = t;
          _clipCbs.forEach(function (cb) { try { cb({ text: t }); } catch (e) {} });
        }).catch(function () {});
      }, 1500);
      toast("已开启剪贴板监听：在别的 App 里拷贝题干，回到这里自动搜题");
      return Promise.resolve({ ok: true });
    },
    stopClipboardWatch: function () {
      if (_clipTimer) { clearInterval(_clipTimer); _clipTimer = null; }
      toast("已停止剪贴板监听");
      return Promise.resolve({ ok: true });
    },
    onClipboardText: function (cb) {
      if (typeof cb === "function") _clipCbs.push(cb);
      return function () {
        var i = _clipCbs.indexOf(cb);
        if (i >= 0) _clipCbs.splice(i, 1);
      };
    }
  };

  /* ==================================================================
   * 3.1 AI 优先（手机端的默认工作方式）
   * ----------------------------------------------------------------
   * 为什么手机端要默认走 AI：
   *   电脑版本地引擎是 Umi-OCR（PaddleOCR PP-OCRv6），中文专门调过，
   *   电脑版实测「本地链路四关全对 71%、AI 视觉 97%」（38 道真题）。
   *   而 iOS 本地只能靠系统 Vision 框架 —— 对带圈数字①②③、形近字
   *   （并/井、硐/洞）、小字密集版面明显更弱，这正是旧手机版当初长出
   *   一整套"错别字字典 + 红底白化 + Otsu 二值化"的原因。
   *   再叠加手机截图是**整屏**的（状态栏/导航/按钮全在里面），
   *   本地路线的起点就更差。所以手机端默认：本地先出结果兜底，
   *   紧接着自动 AI 精读，并以 AI 结果为准。
   *
   * 但绝不把整屏截图直接发上去 —— 先用本地 OCR 的坐标定位题目区，
   * 裁出那一块再发。省 token、少干扰、识别率更高。
   * AI 读失败会自动用整图重试一次，再失败就保留本地结果。
   * ================================================================== */

  function aiFirstOn() {
    try { return localStorage.getItem("sb_ocr_ai_first") !== "0"; } catch (e) { return true; }
  }
  function setAiFirstOn(v) {
    try { localStorage.setItem("sb_ocr_ai_first", v ? "1" : "0"); } catch (e) {}
  }

  /* 把 dataURL 按框裁一块出来（框是原图像素坐标） */
  function cropImageDataURL(dataURL, box, marginRatioX, marginRatioY) {
    return new Promise(function (resolve) {
      if (!dataURL || !box) { resolve(null); return; }
      var img = new Image();
      img.onload = function () {
        try {
          var W = img.naturalWidth, H = img.naturalHeight;
          if (!W || !H) { resolve(null); return; }
          var bw = box.x1 - box.x0, bh = box.y1 - box.y0;
          var mx = Math.max(18, bw * (marginRatioX == null ? 0.10 : marginRatioX));
          var my = Math.max(14, bh * (marginRatioY == null ? 0.08 : marginRatioY));
          var x = Math.max(0, Math.floor(box.x0 - mx));
          var y = Math.max(0, Math.floor(box.y0 - my));
          var x2 = Math.min(W, Math.ceil(box.x1 + mx));
          var y2 = Math.min(H, Math.ceil(box.y1 + my));
          var w = x2 - x, h = y2 - y;
          if (w < 60 || h < 30) { resolve(null); return; }
          var c = document.createElement("canvas");
          c.width = w; c.height = h;
          var ctx = c.getContext("2d");
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
          resolve(c.toDataURL("image/jpeg", 0.92));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = function () { resolve(null); };
      img.src = dataURL;
    });
  }

  /* 把 AI 收到的那张图换成"裁好的题目区小图" —— 安全网是失败就整图重试 */
  function hookAiCrop() {
    if (!window.aiBridge || !window.aiBridge.recognize) return;
    var raw = window.aiBridge.recognize;
    window.aiBridge.recognize = function (opts) {
      opts = opts || {};
      var image = opts.image || "";
      var last = window.__SB.__lastLocalOCR;
      // 只在"紧接着本地识别"的 3 分钟内、且定位到时才裁；其它来源（如导入题库页）不碰
      var fresh = last && (Date.now() - last.ts < 180000);
      if (!image || !fresh || !last.origBox) return raw(opts);

      return cropImageDataURL(image, last.origBox, 0.10, 0.08).then(function (small) {
        if (!small) return raw(opts);
        var o2 = {};
        for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o2[k] = opts[k];
        o2.image = small;
        return raw(o2).then(function (r) {
          if (r && r.ok) {
            window.__SB.__lastAiCropped = true;
            return r;
          }
          console.warn("[bridge] 用题目区小图 AI 精读失败，回退整图重试：", r && r.error);
          window.__SB.__lastAiCropped = false;
          return raw(opts);
        });
      }).catch(function () {
        return raw(opts);
      });
    };
  }

  /* 本地 OCR 完成后，自动点一下页面自己的「用 AI 精读」按钮 ——
     复用网页现成的整条 AI 链路（含按钮态、错误提示、结果渲染），
     桥接层只在"发什么图"上做手脚。 */
  function hookAutoAi() {
    if (!isFn("handleImage")) return;
    var orig = window.handleImage;
    window.handleImage = function () {
      // 新的一张图 → 清掉上一张的定位结果，免得拿旧框去裁新图
      window.__SB.__lastLocalOCR = null;
      var r = orig.apply(this, arguments);
      Promise.resolve(r).then(function () {
        setTimeout(function () { maybeAutoAi(); }, 140);
      }).catch(function () {});
      return r;
    };
  }

  function maybeAutoAi() {
    try {
      if (!native) return;
      if (!aiFirstOn()) return;
      if (!isFn("aiAllowed") || !window.aiAllowed()) return;
      if (!isFn("getActiveModel") || !window.getActiveModel()) return;
      if (!window.aiBridge || !window.aiBridge.recognize) return;
      // 图片识别页在前台才自动跑
      var v = document.getElementById("v-ocr");
      if (!v || !v.classList.contains("on")) return;
      var btn = document.getElementById("ocrAi");
      if (!btn || btn.style.display === "none" || btn.disabled) return;
      btn.click();
    } catch (e) {
      console.warn("[bridge] 自动 AI 精读触发失败：", e);
    }
  }

  /* 净化结果的人话提示（插在 #ocrArea 之前，不会被 renderOcrUI 的重绘冲掉） */
  function ensureCleanInfo() {
    var area = document.getElementById("ocrArea");
    if (!area || !area.parentNode) return null;
    var host = document.getElementById("sbCleanInfo");
    if (!host) {
      host = document.createElement("div");
      host.id = "sbCleanInfo";
      host.style.cssText =
        "display:none;margin-top:10px;padding:8px 12px;border-radius:9px;background:var(--soft);" +
        "border:1px solid var(--line);font-size:13px;line-height:1.6;";
      area.parentNode.insertBefore(host, area);
    }
    return host;
  }

  function showCleanInfo(stats) {
    var host = ensureCleanInfo();
    if (!host) return;
    if (!stats || !stats.totalRows) { host.style.display = "none"; return; }
    var parts = [];
    parts.push(
      '整页净化：识别到 <b>' + stats.totalRows + '</b> 行，保留题目区 <b>' + stats.keptRows + '</b> 行' +
      (stats.droppedRows > 0 ? ('，去掉 <b>' + stats.droppedRows + '</b> 行界面文字') : "")
    );
    if (stats.fallback) {
      parts.push('<span style="color:var(--amber,#b45309)">⚠ 题干定位没把握，已退回"只删确定是界面的行"，没有强行裁剪</span>');
    }
    if (stats.origBox) {
      parts.push('<span class="muted">已定位题目区，交给 AI 时会只发这一块（不传整屏截图）</span>');
    } else if (aiFirstOn()) {
      parts.push('<span class="muted">没能定位出题目区，AI 精读将使用整图</span>');
    }
    if (stats.multiQ >= 2) {
      parts.push('📑 像有 <b>' + stats.multiQ + '</b> 道题，搜题时会按题分别检索');
    }
    if (stats.dropped && stats.dropped.length) {
      var brief = stats.dropped.slice(0, 6).map(function (d) { return "「" + d.text + "」"; }).join("、");
      parts.push('<span class="muted">剔除依据：' + brief + (stats.dropped.length > 6 ? " …" : "") + '</span>');
    }
    host.innerHTML = parts.join("<br>");
    host.style.display = "";
  }

  /* 图片识别页加两个开关按钮 */
  function injectOcrToggles() {
    var shot = document.getElementById("ocrShot");
    if (!shot || !shot.parentNode) return;
    var row = shot.parentNode;
    if (document.getElementById("sbAiFirst")) return;

    function mkBtn(id, text) {
      var b = document.createElement("button");
      b.className = "btn";
      b.id = id;
      b.textContent = text;
      row.appendChild(b);
      return b;
    }
    var bAi = mkBtn("sbAiFirst", "");
    var bClean = mkBtn("sbPageClean", "");

    function paint() {
      var on = aiFirstOn();
      bAi.textContent = "🤖 AI 优先：" + (on ? "开" : "关");
      bAi.title = on
        ? "本地识别后自动用 AI 视觉模型精读一遍（只发题目区域，不发整屏截图），结果以 AI 为准。点一下可关掉。"
        : "当前只用本地识别。点一下打开「AI 优先」。";
      bAi.style.borderColor = on ? "var(--pri)" : "";
      bAi.style.color = on ? "var(--pri-d)" : "";

      var on2 = cleanOn();
      bClean.textContent = "✂ 整页净化：" + (on2 ? "开" : "关");
      bClean.title = on2
        ? "自动剔除截图里的状态栏/导航/按钮等界面文字，只保留题目区。点一下可关掉。"
        : "当前保留整页文字。点一下打开「整页净化」。";
      bClean.style.borderColor = on2 ? "var(--pri)" : "";
      bClean.style.color = on2 ? "var(--pri-d)" : "";
    }

    bAi.addEventListener("click", function () {
      setAiFirstOn(!aiFirstOn());
      paint();
      toast(aiFirstOn() ? "已开启 AI 优先：本地识别后自动 AI 精读（只发题目区域）" : "已关闭 AI 优先，只用本地识别");
      if (aiFirstOn()) {
        var last = window.__SB.__lastLocalOCR;
        if (last) maybeAutoAi();
      }
    });
    bClean.addEventListener("click", function () {
      setCleanOn(!cleanOn());
      paint();
      toast(cleanOn() ? "已开启整页净化：自动剔除界面文字" : "已关闭整页净化：保留整页文字，请重新识别一次");
    });
    paint();
  }

  /* ==================================================================
   * 4. aiBridge —— 走原生 URLSession（绕开 CORS，Key 不出沙盒）
   * ================================================================== */
  function callAI(fn, opts) {
    var model = (opts && opts.model) || null;
    var payload = {
      baseUrl: (model && model.baseUrl) || "",
      apiKey: (model && model.apiKey) || "",
      modelName: (model && model.modelName) || "",
      prompt: (opts && opts.prompt) || "",
      images: (opts && opts.images) || [],
      messages: (opts && opts.messages) || [],
      image: (opts && opts.image) || ""
    };
    return fn(payload).catch(function (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    });
  }

  window.aiBridge = {
    openExternal: function (url) { return window.__SB.openExternal(url); },
    ask: function (opts) { return callAI(window.__SB.aiAsk, opts); },
    chat: function (opts) { return callAI(window.__SB.aiChat, opts); },
    proof: function (opts) { return callAI(window.__SB.aiProof, opts); },
    recognize: function (opts) { return callAI(window.__SB.aiRecognize, opts); }
  };

  /* ==================================================================
   * 5. batchBridge —— 批量识别
   *    iOS 选不了“文件夹”，退化为：从相册挑一张喂给网页。
   * ================================================================== */
  var _batchImgs = {};

  window.batchBridge = {
    pickDir: function () {
      return window.__SB.pickImage().then(function (dataUrl) {
        if (!dataUrl) return { ok: false, canceled: true };
        var key = "ios-photo-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".jpg";
        _batchImgs[key] = dataUrl;
        return { ok: true, dir: "相册", files: [key], single: true };
      }).catch(function (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      });
    },
    readImage: function (filePath) {
      var u = _batchImgs[filePath];
      if (!u) return Promise.resolve({ ok: false, error: "找不到图片" });
      var p = String(u).split(",");
      return Promise.resolve({
        ok: true,
        name: String(filePath).split("/").pop(),
        base64: p.length > 1 ? p[1] : "",
        dataUrl: u
      });
    }
  };

  /* ==================================================================
   * 6. wpsBridge —— iOS 没有 WPS 集成，一律走系统分享面板
   * ================================================================== */
  window.wpsBridge = {
    find: function () { return Promise.resolve(null); },
    saveDocx: function (payload) {
      var name = (payload && payload.name) || "试卷.docx";
      var data = (payload && payload.data) || "";
      var b64 = "";
      if (typeof data === "string") {
        b64 = data.indexOf(",") >= 0 ? data.split(",")[1] : data;
      } else if (data && data.length !== undefined) {
        var s = "";
        for (var i = 0; i < data.length; i++) s += String.fromCharCode(data[i] & 0xff);
        b64 = btoa(s);
      }
      if (!b64) return Promise.resolve({ ok: false, error: "导出内容为空" });
      return window.__SB.shareBinary(
        b64, name,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ).then(function () { return { ok: true, path: name }; })
        .catch(function (e) { return { ok: false, error: (e && e.message) || String(e) }; });
    },
    openFile: function (filePath) {
      toast("文件已导出：" + (filePath || ""));
      return Promise.resolve({ ok: false });
    }
  };

  /* ==================================================================
   * 7. window.Tesseract —— 去掉“首次联网下载引擎”
   * ================================================================== */
  window.Tesseract = window.Tesseract || {
    __iosStub: true,
    createWorker: function () {
      return Promise.resolve({
        recognize: function () { return Promise.resolve({ data: { text: "" } }); },
        terminate: function () { return Promise.resolve(); }
      });
    }
  };

  /* ==================================================================
   * 8. 页面运行时补丁（等网页主体脚本加载完后执行）
   * ================================================================== */
  function isFn(n) { return typeof window[n] === "function"; }

  /* 8.1 让“浏览器本地识别(Tesseract.js)”也走 Vision */
  function patchTesseract() {
    if (!native || !isFn("tesseractRecognize")) return;
    window.tesseractRecognize = function (file, onProg) {
      if (onProg) onProg({ status: "系统离线识别中…" });
      return readAsDataURL(file)
        .then(function (b64) { return window.__SB.ocr(b64); })
        .then(function (text) { return text || ""; });
    };
  }

  /* 8.2 导出备份 → 系统分享面板（网页用 <a download>，WKWebView 不认） */
  function patchExport() {
    if (!native || !isFn("exportJSON")) return;
    window.exportJSON = function () {
      var text, name;
      try {
        text = JSON.stringify(window.DATA, null, 2);
        name = "搜题题库_" + fmtDate(Date.now()) + ".json";
      } catch (e) {
        toast("导出失败：" + ((e && e.message) || e));
        return;
      }
      window.__SB.shareExport(text, name).catch(function () { toast("导出失败"); });
    };
  }

  /* 8.3 导入恢复 → 原生文件选择器（并废掉网页自带的 <input type=file> 链路） */
  function patchImport() {
    if (!native) return;
    var restore = document.getElementById("restoreInput");
    if (restore) restore.click = function () {};

    function intercept(btnId) {
      var btn = document.getElementById(btnId);
      if (!btn || btn.__sbBound) return;
      btn.__sbBound = true;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.__SB.pickFiles().then(function (files) {
          if (!files || !files.length) return;
          files.forEach(function (f) {
            try {
              var name = String(f.name || "").toLowerCase();
              if (name.indexOf(".json") >= 0) {
                if (isFn("ingestBackup")) window.ingestBackup(decodeB64(f.data));
              } else {
                var blob = dataURLtoBlob(
                  "data:" + (f.mime || "application/octet-stream") + ";base64," + f.data
                );
                if (!blob) { toast("文件解析失败：" + f.name); return; }
                var file = new File([blob], f.name, { type: f.mime || blob.type });
                if (isFn("handleFile")) window.handleFile(file);
                else toast("当前版本不支持该文件导入");
              }
            } catch (err) {
              toast("导入失败：" + ((err && err.message) || err));
            }
          });
        }).catch(function () { toast("选择文件失败"); });
      }, true);
    }
    intercept("btnImport");
    intercept("drop");
  }

  /* 8.4 “保存到本地文件夹”在 iOS 上不存在（也不必要）——
        数据本来就自动写进 App 沙盒。把这块 UI 换成人话，别让用户看到
        “当前浏览器不允许网页读写本地文件夹”这种台式机口径。 */
  function patchFolderUI() {
    if (!native) return;
    // “桌面版数据”按钮在这台设备上没有意义
    var st = document.createElement("style");
    st.textContent = "#btnDesktopTools{display:none !important;}";
    document.head.appendChild(st);

    if (isFn("syncFolderUI")) {
      window.syncFolderUI = function () {
        var el = document.getElementById("folderStatus");
        if (el) {
          el.innerHTML = '数据自动保存在 <b>App 内</b>（文件 App → 我的 iPhone → 搜题平台 → data.json），' +
            '容量不受浏览器 5MB 限制，关掉 App 也不会丢。<br>' +
            '<span class="muted" style="font-weight:400">需要备份就点顶部「导出备份」，会弹出系统分享面板，' +
            '可存到「文件」或发给微信/QQ。</span>';
        }
        ["btnBindFolder", "btnSaveNow", "btnUnbindFolder"].forEach(function (id) {
          var b = document.getElementById(id);
          if (b) b.style.display = "none";
        });
      };
    }
  }

  /* 8.5 抑制 localStorage 满的告警
        iOS 上数据本来就走沙盒文件，localStorage 只是内存镜像，
        try/catch 里那句“浏览器缓存已满”会平白吓到用户。 */
  function patchToast() {
    if (!isFn("toast")) return;
    var orig = window.toast;
    window.toast = function (msg, ms) {
      var s = String(msg == null ? "" : msg);
      if (/浏览器缓存已满/.test(s)) {
        console.warn("[bridge] 已忽略 localStorage 容量告警（数据已写入沙盒文件）");
        return;
      }
      return orig.call(window, msg, ms);
    };
  }

  /* ==================================================================
   * 9. 设置项文案／提示本地化
   * ================================================================== */
  function localizeSettings() {
    var sel = document.getElementById("setEngine");
    if (sel) {
      var o1 = sel.querySelector('option[value="umi"]');
      if (o1) o1.textContent = "系统离线识别（iOS Vision — 离线免费，图片不出本机，推荐）";
      var o2 = sel.querySelector('option[value="tesseract"]');
      if (o2) o2.textContent = "浏览器本地识别（Tesseract.js — 需联网下载引擎，手机上很慢，不推荐）";
      var o3 = sel.querySelector('option[value="ocrspace"]');
      if (o3) o3.textContent = "在线接口识别（OCR.space / 百度等，需填接口地址）";
      if (!sel.value) sel.value = "umi";
    }

    // “Umi-OCR 识别选项”整块 → iOS 措辞
    var umiCls = document.getElementById("setUmiCls");
    if (umiCls) {
      var blk = umiCls.closest(".field");
      if (blk) {
        var lab = blk.querySelector("label");
        if (lab && lab !== umiCls.parentElement) lab.textContent = "iOS 离线识别选项";
        else if (lab) lab.textContent = "iOS 离线识别选项";
        var s1 = umiCls.parentElement && umiCls.parentElement.querySelector("span");
        if (s1) s1.textContent = "红色背景自动白化（做题界面红底截图识别更准）";
      }
    }
    var umiLayout = document.getElementById("setUmiLayout");
    if (umiLayout && umiLayout.parentElement) {
      var s2 = umiLayout.parentElement.querySelector("span");
      if (s2) s2.textContent = "按阅读顺序重排（用识别坐标把打乱的行重新排好）";
    }

    var hint = document.getElementById("ocrHint");
    if (hint) {
      hint.innerHTML = '手机版默认是 <b>AI 优先</b>：先用 iOS 系统离线识别（Vision）飞快出一版文字，' +
        '紧接着自动交 AI 视觉模型精读一遍，结果以 AI 为准 —— 电脑版实测本地链路四关全对 ' +
        '<b>71%</b>、AI 视觉 <b>97%</b>。<br>' +
        '<b>截屏是整屏的，不会整屏发上去</b>：先靠本地识别的坐标定位出题目区，' +
        '只把那一条裁下来发给 AI，省流量也更准。AI 读不出来会自动退回整图重试，再不行就保留本地结果。<br>' +
        '不想联网就用上面的「🤖 AI 优先」开关关掉它（涉密材料务必关）；' +
        '「✂ 整页净化」控制是否自动剔除状态栏/导航/按钮这类界面文字。';
    }
    var shot = document.getElementById("ocrShot");
    if (shot) shot.title = "取相册里最新一张图识别（先按「电源+音量上」截屏，再回来点这里）";

    var so = document.getElementById("btnScreenOcr");
    if (so) {
      so.innerHTML = "▶ 开启剪贴板监听";
      so.title = "在别的 App 里拷贝题干文字，回到这里自动填入并搜题。做完题点「停止监听」结束。";
    }
    var stop = document.getElementById("btnClipboardStop");
    if (stop) stop.title = "停止剪贴板监听";
  }

  /* ==================================================================
   * 10. 自适应 UI + iOS 补充样式
   * ================================================================== */
  function applyAdaptive() {
    var d = window.__SB.device || { tier: "mid", isTablet: false, scale: 2 };
    var root = document.documentElement;
    root.classList.add("tier-" + (d.tier || "mid"));
    if (d.isTablet) root.classList.add("is-tablet");
    root.classList.add("sb-ios");

    var css = [
      ":root{--sat:env(safe-area-inset-top);--sab:env(safe-area-inset-bottom);--sal:env(safe-area-inset-left);--sar:env(safe-area-inset-right);}",
      ".main{padding-top:calc(16px + var(--sat)) !important;}",
      "@media(max-width:768px){",
      "  .main{padding-bottom:calc(96px + var(--sab)) !important;}",
      "  .toast{bottom:calc(92px + var(--sab)) !important;}",
      "  .topbar{gap:8px;margin-bottom:14px;}",
      "  .topbar .acts{gap:6px;}",
      "  .topbar .acts .btn{padding:8px 10px;font-size:13px;min-height:40px;}",
      "  .topbar .acts .btn svg{width:15px;height:15px;}",
      "  .searchbox{gap:8px;}",
      "  .searchbox input,.searchbox select{width:100%;min-width:0 !important;flex:1 1 100%;}",
      "  .card{padding:14px;border-radius:12px;}",
      "  .grid-stats{gap:10px;}",
      "  .stat{padding:12px;}",
      "  .stat .n{font-size:22px;}",
      "  .modal{max-width:94vw;max-height:82vh;overflow:auto;}",
      "  .mask{padding:12px;}",
      "  .ai-chat-win{right:8px !important;left:8px !important;bottom:calc(88px + var(--sab)) !important;width:auto !important;}",
      "}",
      ".sb-tablewrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:8px 0;}",
      "table{max-width:100%;}",
      "button,.opt,.mode-card,.bank-card{touch-action:manipulation;}",
      "input,select,textarea{font-size:16px !important;}",
      ".tier-low *{animation:none !important;transition:none !important;}",
      ".tier-low .card,.tier-low .modal,.tier-low .mask{box-shadow:0 1px 2px rgba(0,0,0,.12) !important;}",
      ".tier-high .card{box-shadow:0 10px 30px rgba(15,23,42,.10);}",
      ".is-tablet .wrap{max-width:980px;margin:0 auto;}",
      "@media (prefers-reduced-motion: reduce){*{animation:none !important;transition:none !important;}}",
      "img{max-width:100%;}",
      ".sb-hist{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;}",
      ".sb-hist .sb-hchip{max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 11px;border:1px solid var(--line);border-radius:999px;background:var(--soft);font-size:13px;color:var(--sub);min-height:32px;display:inline-flex;align-items:center;}",
      ".sb-hist .sb-hchip:active{background:var(--pri-bg);color:var(--pri-d);}",
      ".sb-hist .sb-htitle{font-size:12px;color:var(--sub);margin-right:2px;}",
      ".sb-hist .sb-hclr{font-size:12px;color:var(--sub);padding:5px 8px;border-radius:999px;border:1px dashed var(--line);min-height:32px;}"
    ].join("\n");

    var style = document.createElement("style");
    style.id = "sb-ios-style";
    style.textContent = css;
    document.head.appendChild(style);

    Array.prototype.forEach.call(document.querySelectorAll("table"), function (t) {
      if (t.parentElement && t.parentElement.classList.contains("sb-tablewrap")) return;
      var w = document.createElement("div");
      w.className = "sb-tablewrap";
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    });
  }

  /* ==================================================================
   * 11. 搜索历史（原手机版功能，保留）
   * ================================================================== */
  var HIST_KEY = "sb_search_hist";

  function histLoad() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch (e) { return []; }
  }
  function histPush(q) {
    q = String(q || "").replace(/\s+/g, " ").trim();
    if (q.length < 2) return;
    var list = histLoad().filter(function (x) { return x !== q; });
    list.unshift(q);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 12))); } catch (e) {}
    histRender();
  }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }
  function histRender() {
    var box = document.getElementById("searchOcrTip");
    if (!box || !box.parentNode) return;
    var host = document.getElementById("sbHistBar");
    if (!host) {
      host = document.createElement("div");
      host.id = "sbHistBar";
      host.className = "sb-hist";
      box.parentNode.insertBefore(host, box.nextSibling);
    }
    var list = histLoad();
    if (!list.length) { host.innerHTML = ""; host.style.display = "none"; return; }
    host.style.display = "";
    var html = '<span class="sb-htitle">最近搜过</span>';
    list.slice(0, 8).forEach(function (q, i) {
      html += '<button class="sb-hchip" data-i="' + i + '">' + escHtml(q) + "</button>";
    });
    html += '<button class="sb-hclr" id="sbHistClear">清空</button>';
    host.innerHTML = html;
    Array.prototype.forEach.call(host.querySelectorAll(".sb-hchip"), function (b) {
      b.addEventListener("click", function () {
        var q = histLoad()[+b.dataset.i];
        if (!q) return;
        if (isFn("setSearchText")) window.setSearchText(q);
        if (isFn("doSearch")) window.doSearch();
      });
    });
    var c = document.getElementById("sbHistClear");
    if (c) c.addEventListener("click", function () {
      try { localStorage.removeItem(HIST_KEY); } catch (e) {}
      histRender();
    });
  }
  function hookSearchHistory() {
    if (!isFn("doSearch")) return;
    var orig = window.doSearch;
    window.doSearch = function () {
      var q = "";
      try {
        if (isFn("readSearchText")) q = window.readSearchText();
        else {
          var el = document.getElementById("searchInput");
          q = el ? el.value : "";
        }
      } catch (e) {}
      var r = orig.apply(this, arguments);
      try { histPush(q); } catch (e) {}
      return r;
    };
    histRender();
  }

  /* ==================================================================
   * 12. 深链 searchbank://（快捷指令「截屏搜题」用）
   * ================================================================== */
  var _urlQueue = [];

  window.__SB.handleDeepLink = function (urlStr) {
    try {
      var u = String(urlStr || "");
      var rest = u.replace(/^searchbank:\/\//i, "");
      var qIdx = rest.indexOf("?");
      var path = (qIdx >= 0 ? rest.slice(0, qIdx) : rest).replace(/\/+$/, "");
      var qs = {};
      if (qIdx >= 0) {
        rest.slice(qIdx + 1).split("&").forEach(function (kv) {
          if (!kv) return;
          var i = kv.indexOf("=");
          var k = i >= 0 ? kv.slice(0, i) : kv;
          var v = i >= 0 ? kv.slice(i + 1) : "";
          try { qs[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " ")); }
          catch (e) { qs[k] = v; }
        });
      }

      var run = function () {
        if (path === "fab-clip" || path === "clip") {
          return window.__SB.readClipboard().then(function (t) {
            t = (t || "").trim();
            if (!t) { toast("剪贴板是空的"); return; }
            swapToSearch(t);
          });
        }
        if (path === "fab-camera") {
          return window.__SB.captureImage().then(function (x) { if (x) ocrDataURL(x); });
        }
        if (path === "fab-album") {
          return window.__SB.pickImage().then(function (x) { if (x) ocrDataURL(x); });
        }
        if (path === "search") { swapToSearch(qs.q || ""); return; }
        if (path === "ocr") return;
        swapToSearch(qs.q || "");
      };

      if (document.readyState === "loading") _urlQueue.push(run);
      else run();
    } catch (e) { /* 深链失败不影响正常使用 */ }
  };

  function swapToSearch(text) {
    try {
      if (isFn("go")) window.go("search");
      if (isFn("setSearchText")) window.setSearchText(text);
      if (isFn("doSearch")) window.doSearch();
    } catch (e) { toast("打开搜索页失败"); }
  }

  function ocrDataURL(dataUrl) {
    try {
      var file = dataURLtoFile(dataUrl, "searchbank-" + Date.now() + ".jpg");
      if (!file) { toast("图片解析失败"); return; }
      if (isFn("go")) window.go("ocr");
      if (isFn("handleImage")) window.handleImage(file);
      else toast("当前页面不支持图片识别");
    } catch (e) {
      toast("识别失败：" + ((e && e.message) || e));
    }
  }

  if (window.__SB.__pendingURL) {
    var _p = window.__SB.__pendingURL;
    window.__SB.__pendingURL = null;
    _urlQueue.push(function () { window.__SB.handleDeepLink(_p); });
  }

  /* ==================================================================
   * 13. 启动
   * ================================================================== */

  /* 调试/自测出口：把纯函数暴露出来，便于无头环境（Electron/Node）单测。
     对线上行为没有任何影响。 */
  window.__SB.__test = {
    sanitizePage: sanitizePage,
    rowGroupBlocks: rowGroupBlocks,
    classifyRow: classifyRow,
    looksLikeUIRow: looksLikeUIRow,
    cropImageDataURL: cropImageDataURL,
    maybeAutoAi: maybeAutoAi,
    isFn: isFn
  };
  function syncNativeOcrSettings() {
    if (!native) return;
    var cls = document.getElementById("setUmiCls");
    var layout = document.getElementById("setUmiLayout");
    if (cls) window.__SB.setSetting("sb_ocr_whiten_red", !!cls.checked);
    // 「按阅读顺序重排」→ 原生识别也按行分组
    if (layout) window.__SB.setSetting("sb_ocr_single_col", !!layout.checked);
  }

  function seedFromBundle() {
    if (!native) return;
    var seeded = false;
    try { seeded = localStorage.getItem("sb_seeded") === "1"; } catch (e) {}
    if (seeded) return;
    window.__SB.loadData().then(function (t) {
      if (t && t.length > 100) {
        try { localStorage.setItem("sb_seeded", "1"); } catch (e) {}
        return;
      }
      return fetch("搜题题库.json").then(function (r) { return r.text(); })
        .then(function (txt) {
          var bank = JSON.parse(txt);
          var D = window.DATA;
          if (bank && Array.isArray(bank.items) && bank.items.length && D) {
            D.items = bank.items;
            if (Array.isArray(bank.banks)) D.banks = bank.banks;
            if (isFn("save")) window.save();
            if (isFn("renderHome")) window.renderHome();
            if (isFn("fillCatFilter")) window.fillCatFilter();
            toast("已载入本地题库 " + bank.items.length + " 题（离线可用）");
          }
          try { localStorage.setItem("sb_seeded", "1"); } catch (e) {}
        });
    }).catch(function () {});
  }

  function boot() {
    patchToast();          // 最先：后面几个补丁可能触发 toast
    applyAdaptive();
    localizeSettings();
    patchTesseract();
    patchExport();
    patchImport();
    patchFolderUI();
    hookSearchHistory();

    // 手机端的两条主线：AI 优先 + 整页净化
    hookAiCrop();
    hookAutoAi();
    injectOcrToggles();
    ensureCleanInfo();

    while (_urlQueue.length) {
      try { _urlQueue.shift()(); } catch (e) {}
    }

    seedFromBundle();

    setTimeout(syncNativeOcrSettings, 600);
    document.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.id) return;
      if (t.id === "setUmiCls" || t.id === "setUmiLayout" || t.id === "setEngine") {
        setTimeout(syncNativeOcrSettings, 60);
      }
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
