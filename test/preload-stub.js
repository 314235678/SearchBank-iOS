/* =====================================================================
 * E2E 预加载桩：在网页脚本之前把 window.webkit.messageHandlers.bridge 造出来
 * ---------------------------------------------------------------------
 * 这样 www/index.html 就会以为自己跑在真机的 WKWebView 里，
 * 桥接层（app-bridge.js）会走完整真实路径，而不是降级分支。
 * 原生侧（Swift）的返回由 window.__STUB 里的数据模拟。
 * ===================================================================== */
(function () {
  window.__STUB_LOG = [];
  window.__PAGE_ERRORS = [];
  window.addEventListener("error", function (e) {
    window.__PAGE_ERRORS.push(String((e && e.message) || e));
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    window.__PAGE_ERRORS.push("unhandledrejection: " + String((r && r.message) || r));
  });
  window.__STUB = {
    ocrBlocks: { blocks: [], w: 0, h: 0, scale: 1, cropTop: 0, cropBottom: 0, ow: 0, oh: 0 },
    ocrText: "",
    data: "",
    aiResult: { ok: false, error: "stub 未设置 aiResult" },
    // pickFiles 返回什么（模拟用户从「文件」App 选到的文件）
    pickFilesResult: [],
    // 模拟原生沙盒里暂存的待导入备份（原始字节）；由 readImportChunk 分块吐出
    stagedBytes: null
  };

  function bytesToB64(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }
  function utf8Bytes(str) {
    return new TextEncoder().encode(str);
  }
  window.__STUB.utf8Bytes = utf8Bytes;

  function respond(id, result) {
    setTimeout(function () {
      try {
        if (window.__SB && window.__SB.__onNative) window.__SB.__onNative(id, result);
      } catch (e) { /* ignore */ }
    }, 4);
  }

  window.webkit = {
    messageHandlers: {
      bridge: {
        postMessage: function (msg) {
          var type = msg && msg.type;
          var payload = (msg && msg.payload) || {};
          window.__STUB_LOG.push({ type: type, payload: payload });
          switch (type) {
            case "ocrBlocks":
              respond(msg.id, window.__STUB.ocrBlocks);
              break;
            case "ocr":
              respond(msg.id, { text: window.__STUB.ocrText });
              break;
            case "loadData":
              respond(msg.id, { text: window.__STUB.data });
              break;
            case "saveData":
              respond(msg.id, { ok: true });
              break;
            case "dataPath":
              respond(msg.id, { path: "/var/mobile/Containers/.../SearchBank/data.json" });
              break;
            case "getBundledBank":
              respond(msg.id, { text: '{"items":[],"banks":[]}' });
              break;
            case "aiRecognize":
            case "aiAsk":
            case "aiChat":
            case "aiProof":
              respond(msg.id, window.__STUB.aiResult);
              break;
            case "readClipboard":
              respond(msg.id, { text: window.__STUB.clipboard || "" });
              break;
            case "writeClipboard":
            case "setSetting":
            case "processURL":
              respond(msg.id, { ok: true });
              break;
            case "getSetting":
              respond(msg.id, { value: null });
              break;
            case "shareExport":
            case "shareBinary":
              respond(msg.id, { ok: true });
              break;
            case "pickFiles":
              respond(msg.id, { files: window.__STUB.pickFilesResult || [] });
              break;
            /* v3.0.1：分块读取暂存备份。
               刻意按**原始字节**切，不管 UTF-8 边界 —— 真机就是这个行为，
               桥接层必须在字节层拼接后才解码，否则汉字会被切断成乱码。 */
            case "readImportChunk":
              (function () {
                var buf = window.__STUB.stagedBytes;
                if (!buf) {
                  respond(msg.id, { error: "没有待导入的备份文件（请重新选择文件）" });
                  return;
                }
                var off = payload.offset || 0;
                var len = payload.length || 262144;
                var slice = buf.slice(off, Math.min(off + len, buf.length));
                var next = off + slice.length;
                respond(msg.id, {
                  data: bytesToB64(slice),
                  next: next,
                  eof: next >= buf.length,
                  size: buf.length
                });
              })();
              break;
            default:
              respond(msg.id, { ok: true });
          }
        }
      }
    }
  };
})();
