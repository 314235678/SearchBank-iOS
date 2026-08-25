/* =====================================================================
 * 搜题平台 · iOS 桥接层（app-bridge.js）
 * 仅在原生 App（WKWebView，window.webkit.messageHandlers.bridge 存在）中
 * 接管 OCR / 文件导入 / 导出分享，并做设备自适应；网页版在普通浏览器中
 * 打开时本文件自动降级为原逻辑（Tesseract / OCR.space / 原生文件选择）。
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
      // 低端机：关闭动画/过渡，弱化阴影与毛玻璃，省电更流畅
      ".tier-low *{animation:none !important;transition:none !important;}",
      ".tier-low .card,.tier-low .modal,.tier-low .mask{box-shadow:0 1px 2px rgba(0,0,0,.12) !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;}",
      ".tier-low img.imgprev{max-width:100%;}",
      // 高端机：增强层次感
      ".tier-high .card{box-shadow:0 10px 30px rgba(15,23,42,.10);}",
      ".tier-high .modal{box-shadow:0 20px 60px rgba(15,23,42,.18);}",
      // 平板：加宽内容，提升可读性
      ".is-tablet .wrap{max-width:980px;margin:0 auto;}",
      // 尊重系统“减少动态效果”
      "@media (prefers-reduced-motion: reduce){*{animation:none !important;transition:none !important;}}",
      // 让 WebView 内可正常选中/复制文字
      "img{max-width:100%;}"
    ].join("\n");
    document.head.appendChild(style);
  }

  // ===================== 首次启动：载入包内题库 =====================
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
            save();
            localStorage.setItem("sb_seeded", "1");
            if (typeof renderHome === "function") renderHome();
            if (typeof fillCatFilter === "function") fillCatFilter();
            toast("已载入本地题库 " + bank.items.length + " 题（离线可用）");
          }
        })
        .catch(function (e) { console.warn("seed failed", e); });
    } catch (e) { console.warn("seed failed", e); }
  }

  // ===================== 让 OCR 走原生离线引擎 =====================
  function patchOCR() {
    if (!native) return;
    // 覆盖 tesseractRecognize：原网页的「本地识别」分支与「重新识别」按钮都会走到这里
    var _orig = window.tesseractRecognize;
    window.tesseractRecognize = function (file, onProg) {
      if (onProg) onProg({ status: "本地离线识别中…" });
      return Promise.resolve()
        .then(function () {
          try { return compressImage(file).then(function (c) { return c.src; }); }
          catch (e) { return readAsDataURL(file); }
        })
        .then(function (b64) { return window.__SB.ocr(b64); })
        .catch(function (e) {
          if (_orig) return _orig(file, onProg);
          throw e;
        });
    };
  }

  // ===================== 让「导出备份」走系统分享面板 =====================
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

  // 网页版导出 .json 的合并逻辑（与内联脚本 #restoreInput 处理一致）
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
      save();
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
    if (!native) return; // 仅在原生 App 内拦截；普通浏览器保持原文件选择逻辑
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
      true // 捕获阶段拦截，阻止原 file input 弹窗
    );
  }

  function boot() {
    applyAdaptive();
    patchOCR();
    patchExport();
    interceptImport("btnImport");
    interceptImport("drop");
    seedIfNeeded();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
