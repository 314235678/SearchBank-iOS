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
    stagedBytes: null,
    // 模拟相册/相机/最新截图返回的图片（1x1 PNG，只要能被 dataURLtoFile 认成 image/*）
    imageResult: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    clipboard: "",
    // 剪贴板富探测：changeCount 门控 + 内容
    clip: { changeCount: 1, kind: "text", text: "" },
    // 内置题库（getBundledBank）返回的内容
    bundledBank: '{"items":[],"banks":[]}'
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

  /* =====================================================================
   * 沙盒持久化模拟（m6）
   * ---------------------------------------------------------------------
   * 真机上「设置 / 其它小键值」是写进沙盒文件的。这里必须也**真的落盘**，
   * 否则测不出「保存后重启还在不在」—— 内存变量在页面 reload 后就没了，
   * 而 reload 正是我们用来模拟"重启 App"的手段。
   * 落盘位置：test/_stub-persist.json（E2E 每次开跑前会删除它，保证干净）。
   * ===================================================================== */
  var fs = null, STORE_PATH = null;
  try {
    fs = require("fs");
    STORE_PATH = require("path").join(__dirname, "_stub-persist.json");
  } catch (e) { fs = null; }

  function loadStore() {
    if (!fs) return { settings: "", kv: {} };
    try {
      var o = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
      if (!o || typeof o !== "object") return { settings: "", kv: {} };
      if (!o.kv) o.kv = {};
      return o;
    } catch (e) { return { settings: "", kv: {} }; }
  }
  function saveStore() {
    if (!fs) return;
    try { fs.writeFileSync(STORE_PATH, JSON.stringify(STORE), "utf8"); } catch (e) {}
  }
  var STORE = loadStore();
  window.__STUB_STORE = STORE;
  window.__STUB_PERSIST_OK = !!fs;

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
            case "aiRecognize":
            case "aiAsk":
            case "aiChat":
            case "aiProof":
              respond(msg.id, window.__STUB.aiResult);
              break;
            case "readClipboard":
              respond(msg.id, { text: window.__STUB.clipboard || "" });
              break;
            /* 剪贴板富探测：模拟原生的 changeCount 门控行为 ——
               since 与当前一致或 peek 时，**不回内容**（真机上这步不读剪贴板、
               不会触发「允许粘贴」弹窗）。 */
            case "readClipboardRich":
              (function () {
                var c = window.__STUB.clip || {};
                var since = payload.since == null ? -1 : payload.since;
                if (payload.peek || (since >= 0 && since === c.changeCount)) {
                  respond(msg.id, {
                    changeCount: c.changeCount, changed: false, kind: "same"
                  });
                  return;
                }
                var r = { changeCount: c.changeCount, changed: true, kind: c.kind || "empty" };
                if (c.kind === "text") r.text = c.text || "";
                if (c.kind === "image") r.dataUrl = c.dataUrl || window.__STUB.imageResult;
                respond(msg.id, r);
              })();
              break;
            case "getBundledBank":
              respond(msg.id, { text: window.__STUB.bundledBank || "" });
              break;
            // 图片来源：相册 / 相机 / 相册最新一张
            case "pickImage":
            case "captureImage":
            case "pickLatestPhoto":
              respond(msg.id, { dataUrl: window.__STUB.imageResult });
              break;
            case "writeClipboard":
            case "processURL":
              respond(msg.id, { ok: true });
              break;
            /* m6：设置读写（真机 = Documents/SearchBank/settings.json） */
            case "loadSettings":
              respond(msg.id, { text: STORE.settings || "" });
              break;
            case "saveSettings":
              STORE.settings = payload.text || "";
              saveStore();
              respond(msg.id, { ok: true });
              break;
            /* m6：小键值读写（真机 = 原生 UserDefaults，用于 localStorage 镜像） */
            case "setSetting":
              STORE.kv[String(payload.key || "")] = payload.value;
              saveStore();
              respond(msg.id, { ok: true });
              break;
            case "getSetting":
              (function () {
                var k = String(payload.key || "");
                /* 真机缺键时会走到 respond 的 json-encode 兜底、回 {error:...}；
                   这里直接回 null，让桥接把"没有"和"有值"分开。 */
                respond(msg.id, Object.prototype.hasOwnProperty.call(STORE.kv, k)
                  ? { value: STORE.kv[k] } : { value: null });
              })();
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
