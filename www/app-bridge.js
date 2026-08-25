/* =====================================================================
 * 搜题平台 · iOS 桥接层（app-bridge.js）
 * 仅在原生 App（WKWebView，window.webkit.messageHandlers.bridge 存在）中
 * 接管 OCR / 文件导入 / 导出分享 / 本地持久化，并做设备自适应。
 * 网页版在普通浏览器中打开时本文件自动降级为原逻辑。
 * ===================================================================== */
(function () {
  "use strict";

  var handler =
    window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.bridge;
  var native = !!handler;

  var pending = {};
  var seq = 0;

  function post(type, payload) {
    return new Promise(function (resolve, reject) {
      if (!handler) {
        reject(new Error("native bridge unavailable"));
        return;
      }
      var id = "m" + ++seq;
      pending[id] = resolve;
      handler.postMessage({ id: id, type: type, payload: payload || null });
    });
  }

  // 原生回调入口：window.__SB.__onNative(id, result)
  window.__SB = window.__SB || {};
  window.__SB.native = native;
  window.__SB.__onNative = function (id, result) {
    var r = pending[id];
    if (r) {
      delete pending[id];
      r(result || {});
    }
  };

  // ---- 原生能力封装 ----
  window.__SB.ocr = function (base64) {
    return post("ocr", { base64: base64 }).then(function (r) {
      if (r.error) throw new Error(r.error);
      return r.text || "";
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

  window.__SB.device = window.__SB.device || {
    tier: "mid",
    isTablet: false,
    scale: window.devicePixelRatio || 2,
    native: native
  };

  // ===================== 自适应 UI =====================
  function applyAdaptive() {
    var d = window.__SB.device;
    var root = document.documentElement;
    root.classList.add("tier-" + (d.tier || "mid"));
    if (d.isTablet) root.classList.add("is-tablet");

    var style = document.createElement("style");
    style.textContent = [
      ":root{--sat:env(safe-area-inset-top);--sab:env(safe-area-inset-bottom);--sal:env(safe-area-inset-left);--sar:env(safe-area-inset-right);}",
      "body{padding-top:var(--sat);padding-bottom:var(--sab);padding-left:var(--sal);padding-right:var(--sar);}",
      ".tier-low *{animation:none !important;transition:none !important;}",
      ".tier-low .card,.tier-low .modal,.tier-low .mask{box-shadow:0 1px 2px rgba(0,0,0,.12) !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;}",
      ".tier-low img.imgprev{max-width:100%;}",
      ".tier-high .card{box-shadow:0 10px 30px rgba(15,23,42,.10);}",
      ".tier-high .modal{box-shadow:0 20px 60px rgba(15,23,42,.18);}",
      ".is-tablet .wrap{max-width:980px;margin:0 auto;}",
      "@media (prefers-reduced-motion: reduce){*{animation:none !important;transition:none !important;}}",
      "img{max-width:100%;}",
      "*{-webkit-touch-callout:none;}"
    ].join("\n");
    document.head.appendChild(style);
  }

  // ===================== 首次启动：从本地文件载入 =====================
  function loadFromNative() {
    if (!native) return Promise.resolve(false);
    return window.__SB.loadData().then(function (text) {
      if (!text) return false;
      try {
        var d = JSON.parse(text);
        if (d && (Array.isArray(d.items) || Array.isArray(d.banks))) {
          if (Array.isArray(d.items))  DATA.items  = d.items;
          if (Array.isArray(d.banks))  DATA.banks  = d.banks;
          try { localStorage.setItem("sb_seeded_from_file", "1"); } catch (e) {}
          return true;
        }
      } catch (e) { console.warn("native data parse failed", e); }
      return false;
    }).catch(function () { return false; });
  }

  // ===================== 让 save() 在原生环境多写一份到沙盒文件 =====================
  function patchSave() {
    if (!native) return;
    if (window.__SB.__savePatched) return;
    window.__SB.__savePatched = true;
    var _save = window.save;
    if (typeof _save !== "function") return;
    window.save = function () {
      var ok = true;
      try { _save(); } catch (e) { ok = false; }
      try {
        var text = JSON.stringify(DATA);
        window.__SB.saveData(text).then(function (wrote) {
          if (!wrote) console.warn("native saveData failed");
        });
      } catch (e) { /* JSON.stringify unlikely */ }
      return ok;
    };
  }

  // ===================== 首次启动：载入包内题库（兜底） =====================
  function seedIfNeeded() {
    try {
      if (!native) return;
      if (localStorage.getItem("sb_seeded") === "1") return;
      fetch("搜题题库.json")
        .then(function (r) { return r.text(); })
        .then(function (txt) {
          var bank = JSON.parse(txt);
          if (bank && Array.isArray(bank.items) && bank.items.length) {
            DATA.items = bank.items;
            if (Array.isArray(bank.banks)) DATA.banks = bank.banks;
            try { window.save(); } catch (e) {}
            localStorage.setItem("sb_seeded", "1");
            if (typeof renderHome === "function") renderHome();
            if (typeof fillCatFilter === "function") fillCatFilter();
            toast("已载入本地题库 " + bank.items.length + " 题（离线可用）");
          }
        })
        .catch(function (e) { console.warn("seed failed", e); });
    } catch (e) { console.warn("seed failed", e); }
  }

  // ===================== OCR：题干提炼 =====================
  // 噪声词（命中即整行剔除）：这些是常见题库 app/浏览器 UI 元素
  var NOISE_WORDS = [
    "考试宝", "考试吧", "答题", "背题", "语音", "搜题", "单选", "多选",
    "判断题", "填空题", "简答题", "分享", "收藏", "已做题", "关注公众号",
    "扫码", "扫一扫", "AI深", "AI浅", "官方", "微信", "客服",
    "分享到", "分享给", "更多资料", "下载", "更多"
  ];
  // URL/邮箱等结构化噪声
  var NOISE_REGEXES = [
    /^https?:\/\//i,
    /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
    /^第\s*\d+\s*页/i,
    /^\d{4}[\.\-/]\d{1,2}[\.\-/]\d{1,2}/,    // 2024.01.01
    /^\s*[\d.,:：、\-()（）]+\s*$/,           // 纯符号数字
    /^\s*[\W_]+\s*$/                         // 全非字母数字
  ];

  function isNoiseLine(s) {
    if (!s || s.length <= 1) return true;
    for (var i = 0; i < NOISE_REGEXES.length; i++) {
      if (NOISE_REGEXES[i].test(s)) return true;
    }
    var lower = s.toLowerCase();
    for (var j = 0; j < NOISE_WORDS.length; j++) {
      if (s.indexOf(NOISE_WORDS[j]) >= 0) return true;
    }
    return false;
  }

  // 题干关键词：哪个最先出现就视为题干起点
  var STEM_TRIG = /(下列|关于|请|以下|哪一?|不属|不属于|属于|正确|错误|说法|表述|指出)/;
  // "16、" / "16." 形式的题号
  var STEM_NUM  = /^\s*\d{1,3}\s*[、.]/;
  var QMARK = /[?？]/;

  /**
   * 把识别结果处理成"更适合搜题"的文本。
   * 入参 raw = OCR 原文（可能多行、可能粘连）
   * 出参 { stem, raw }：stem = 提炼版；raw = 清理后的原文（去掉噪声行，方便人工编辑）
   */
  function extractQuestionText(raw) {
    if (!raw) return { stem: "", raw: "" };
    // Vision 在移动端小屏上常常把多块文本拼到一起不换行，先尝试按常见分隔符拆
    var lineList;
    if (/\n/.test(raw)) {
      lineList = String(raw).replace(/\r\n?/g, "\n").split("\n");
    } else {
      // 用 "前导题号 + 分隔" 启发式分行：A. / B. / C. / 数字 题号
      lineList = String(raw)
        // 在题号 "16、" 之前插一个换行
        .replace(/(\s|^)(\d{1,3}\s*[、.])/g, "\n$2")
        // 在 A./B./C./D. 之前插换行
        .replace(/(\s|^)([A-Da-d])[\.、:：\s]+/g, "\n$2. ")
        // 在 ) 或 ） 后接中文前插换行
        .replace(/([。！？\?\)）])\s*([\u4e00-\u9fa5\d])/g, "$1\n$2")
        .split("\n");
    }

    // 清洗
    var cleaned = [];
    for (var i = 0; i < lineList.length; i++) {
      var s = String(lineList[i] || "");
      s = s.replace(/[\s\u3000]+/g, " ").trim();
      if (!s) continue;
      if (isNoiseLine(s)) continue;
      cleaned.push(s);
    }
    if (!cleaned.length) return { stem: "", raw: "" };

    // 找题干起点：含关键词；或行首为题号；或行内含 ?
    var stemStart = -1;
    for (var k = 0; k < cleaned.length; k++) {
      var line = cleaned[k];
      if (STEM_TRIG.test(line) || QMARK.test(line) || STEM_NUM.test(line)) {
        stemStart = k;
        break;
      }
    }

    // 提炼 stem：
    //  - 题干起点存在：从题干起点 + 接下来所有 A/B/C 行及后面不带"分享/收藏/考试宝"之类长尾
    //  - 题干起点不存在：取最长的连续非噪声块当候选
    var stem;
    if (stemStart >= 0) {
      stem = cleaned.slice(stemStart).join("\n");
      // 如果到末尾突然冒出来一个噪声短语（很可能是末尾页脚），截断
      var cutAt = stem.length;
      for (var t = stemStart + 1; t < cleaned.length; t++) {
        var remain = cleaned.slice(t).join(" ");
        if (/分享|收藏|已做题|考试宝|真题|app/i.test(cleaned[t]) && t > stemStart + 1) break;
      }
      // 简化版：只截到最后一个 A./B./C./D. 的下一行（如果是 \d+/数字行就丢掉）
      var lastOption = -1;
      for (var u = stemStart; u < cleaned.length; u++) {
        if (/^\s*[A-D]\s*[.、:：]/.test(cleaned[u]) ||
            /^\s*[A-D]\s*[、.]\s*\S/.test(cleaned[u])) lastOption = u;
      }
      if (lastOption >= 0 && lastOption < cleaned.length - 1) {
        stem = cleaned.slice(stemStart, lastOption + 1).join("\n");
      } else {
        stem = cleaned.slice(stemStart).join("\n");
      }
    } else {
      // 无明显关键词：取整段清理后的文字
      stem = cleaned.join("\n");
    }

    return { stem: stem, raw: cleaned.join("\n") };
  }

  window.__SB.extractQuestionText = extractQuestionText;

  // ===================== 覆盖 tesseractRecognize：走原生离线 OCR + 自动提炼 =====================
  function patchOCR() {
    if (!native) return;
    var _orig = window.tesseractRecognize;
    window.tesseractRecognize = function (file, onProg) {
      if (onProg) onProg({ status: "本地离线识别中…" });
      return Promise.resolve()
        .then(function () {
          try { return compressImage(file).then(function (c) { return c.src; }); }
          catch (e) { return readAsDataURL(file); }
        })
        .then(function (b64) { return window.__SB.ocr(b64); })
        .then(function (text) {
          var ex = window.__SB.extractQuestionText(text);
          // 把全文/清理版挂到原生能力上，UI 可选切换；返回值仍是 string
          // （保持与网页版原 tesseractRecognize 的接口兼容，避免破坏其它调用方）
          window.__SB.__lastOCR = {
            raw:     text,         // OCR 识别原文
            cleaned: ex.raw,       // 去掉噪声行后的全文
            stem:    ex.stem,      // 自动提炼的"题干+选项"
            mode:    "stem"
          };
          return ex.stem || text;
        })
        .catch(function (e) {
          if (_orig) return _orig(file, onProg);
          throw e;
        });
    };
  }

  // ===================== 让"导出备份"走系统分享面板 =====================
  function patchExport() {
    if (!native) return;
    var _orig = window.exportJSON;
    window.exportJSON = function () {
      try {
        var text = JSON.stringify(DATA, null, 2);
        var name = "搜题题库_" + fmtDate(Date.now()) + ".json";
        return window.__SB.shareExport(text, name);
      } catch (e) {
        if (_orig) return _orig();
        throw e;
      }
    };
  }

  // ===================== 导入：原生文件选择器 =====================
  function b64ToUtf8(b64) {
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
  function b64ToBlob(b64, mime) {
    var bin = atob(b64);
    var len = bin.length;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || "application/octet-stream" });
  }

  window.ingestBackup = function (text) {
    var d = JSON.parse(text);
    if (!d.items || !Array.isArray(d.items)) throw new Error("格式不对");
    confirm2("导入恢复", "将合并 " + d.items.length + " 条记录到当前题库？", function () {
      d.items.forEach(function (it) { if (!it.id) it.id = uid(); });
      DATA.items = DATA.items.concat(d.items);
      if (Array.isArray(d.banks)) {
        var ids = {};
        (DATA.banks || []).forEach(function (b) { ids[b.id] = true; });
        d.banks.forEach(function (b) { if (!ids[b.id]) { DATA.banks.push(b); ids[b.id] = true; } });
      }
      try { window.save(); } catch (e) { /* patchSave 已包 */ }
      if (typeof fillCatFilter === "function") fillCatFilter();
      toast("已恢复 " + d.items.length + " 条");
    });
  };

  function handleNativeFiles(files) {
    (files || []).forEach(function (f) {
      var name = (f.name || "").toLowerCase();
      try {
        if (name.endsWith(".json")) {
          window.ingestBackup(b64ToUtf8(f.data));
        } else if (name.endsWith(".csv")) {
          var csvFile = new File([b64ToUtf8(f.data)], f.name, { type: "text/csv" });
          if (typeof window.handleFile === "function") window.handleFile(csvFile);
          else toast("当前版本不支持该文件导入");
        } else if (
          name.endsWith(".xlsx") ||
          name.endsWith(".xls") ||
          name.endsWith(".docx")
        ) {
          var blob = b64ToBlob(f.data, f.mime || "application/octet-stream");
          var docFile = new File([blob], f.name, {
            type: f.mime || "application/octet-stream"
          });
          if (typeof window.handleFile === "function") window.handleFile(docFile);
          else toast("当前版本不支持该文件导入");
        } else {
          toast("不支持的文件：" + (f.name || ""));
        }
      } catch (e) {
        toast("导入失败：" + (e && e.message ? e.message : e));
      }
    });
  }

  function interceptImport(buttonId) {
    if (!native) return;
    var btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.addEventListener(
      "click",
      function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.__SB
          .pickFiles()
          .then(function (files) {
            if (files && files.length) handleNativeFiles(files);
          })
          .catch(function () { toast("选择文件失败"); });
      },
      true
    );
  }

  function boot() {
    applyAdaptive();
    patchSave();          // 必须在 patchExport 之前（依赖 window.save 存在）
    patchOCR();
    patchExport();
    interceptImport("btnImport");
    interceptImport("drop");
    // 启动顺序：先同步种子覆盖（从 IndexedDB/localStorage），再异步从文件覆盖
    Promise.resolve()
      .then(loadFromNative)
      .then(function (loaded) {
        if (loaded) {
          if (typeof renderHome === "function") renderHome();
          if (typeof fillCatFilter === "function") fillCatFilter();
          toast("已从本机文件恢复题库（" + (DATA.items ? DATA.items.length : 0) + " 条）");
        } else {
          seedIfNeeded();
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
