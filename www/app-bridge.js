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

  /** 拍照：弹出系统相机 (UIImagePickerController)，返回 data URL。 */
  window.__SB.captureImage = function () {
    return post("captureImage", {}).then(function (r) {
      if (r && r.error) throw new Error(r.error);
      return (r && r.dataUrl) || "";
    });
  };

  /** 选图：弹系统相册 (PHPickerViewController)，返回 data URL；用户取消返回空串。 */
  window.__SB.pickImage = function () {
    return post("pickImage", {}).then(function (r) {
      if (r && r.error) throw new Error(r.error);
      return (r && r.dataUrl) || "";
    });
  };

  /** 读相册最新一张图（默认就是刚截的屏），返回 data URL。 */
  window.__SB.pickLatestPhoto = function () {
    return post("pickLatestPhoto", {}).then(function (r) {
      if (r && r.error) throw new Error(r.error);
      return (r && r.dataUrl) || "";
    });
  };

  /** URL scheme 唤醒确认（实际跳转逻辑由 AppDelegate/ViewController 通过注入 JS 完成）。 */
  window.__SB.processURL = function (params) {
    return post("processURL", { params: params || {} }).then(function (r) {
      return !(r && r.error);
    });
  };

  /**
   * v2.8 设置写入（OCR 行为控制）
   *   key = "sb_ocr_whiten_red" | "sb_ocr_max_edge" | "sb_ocr_single_col"
   *   value = bool/int/str
   * 写入 Swift UserDefaults，下次 OCR 调用立即生效
   */
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

  /**
   * 解析 searchbank:// URL 并触发对应行为
   *   searchbank://fab-camera       → 触发 FAB 拍照
   *   searchbank://fab-album        → 触发 FAB 相册
   *   searchbank://fab-clipboard    → 触发 FAB 剪贴板
   *   searchbank://search?q=题干     → 直接搜题（跳到 search 视图并填入）
   *   searchbank://launch           → 单纯打开
   * 任何 page 加载完都可调
   */
  window.__SB.handleDeepLink = function (urlStr) {
    try {
      var u = new URL(urlStr);
      var host = u.host || (u.pathname || "").replace(/^\/+/, "");
      var params = {};
      u.searchParams.forEach(function (v, k) { params[k] = v; });

      function fireFAB(act) {
        var btn = document.querySelector('.fab-btn[data-act="' + act + '"]');
        if (btn) { btn.click(); return true; }
        return false;
      }

      if (host === "fab-camera")      fireFAB("camera");
      else if (host === "fab-album")  fireFAB("album");
      else if (host === "fab-clipboard" || host === "fab-clip") fireFAB("clipboard");
      else if (host === "ocr-latest" || host === "shot") {
        // 截屏搜题：先切到 OCR 视图，再让 __SB.ocrLatest() 读相册最新一张并跑 OCR+搜题
        if (typeof go === "function") go("ocr");
        setTimeout(function () {
          if (window.__SB && typeof window.__SB.ocrLatest === "function") window.__SB.ocrLatest();
        }, 350);
      }
      else if (host === "search") {
        if (typeof go === "function") go("search");
        if (params.q) {
          var inp = $("#searchInput"); if (inp) inp.value = params.q;
          if (typeof doSearch === "function") doSearch();
        }
      } else if (host === "ocr" || host === "launch") {
        if (typeof go === "function") go(host === "ocr" ? "ocr" : "home");
      }
    } catch (e) { console.warn("handleDeepLink failed", e); }
  };

  // 消费早于 __SB.handleDeepLink 注册前到达的 URL（冷启动时 didFinish 才注入）
  if (window.__SB.__pendingURL) {
    var pending = window.__SB.__pendingURL;
    window.__SB.__pendingURL = null;
    // 延后一帧，确保页面已绑定好事件
    setTimeout(function () { window.__SB.handleDeepLink(pending); }, 0);
  }

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
  // 噪声词（命中即整行剔除）：覆盖"考试宝/每日一测/答题卡/答案解析/历史/错题"等做题界面 UI
  // 【v2.7 重要修复】单选/多选/判断题 等题型标签**只剔除独立成行**的，不能剔除与题号+题干拼成行的
  // （如"单选 2、为预防工作面两端发生漏顶"—— 整行被剔除就把题干也干掉了）
  // 【v2.8】错别字纠正字典：Vision OCR 容易把形近字搞错（炕/烷、设/没、的/地/得 等），
  //   搜题前做一次纠正。借鉴 Umi-OCR 的"OCR 文本后处理"功能。
  // 【v2.12 重写】只保留真实纠正项（去掉自映射/重复 key），补常用 OCR 错字
  var OCR_TYPO_FIXES = {
    // ===== 学习强企/考试宝界面标题 =====
    "娄试复习":"考试复习","考试复刁":"考试复习","考试复旧":"考试复习",
    "考试宝":"考试宝","考试吧":"考试宝","学习强企":"学习强企",
    "单选题":"单选题","多选择题":"多选题","多选题":"多选题","判断题":"判断题",
    // ===== 安全/矿山类常见字 =====
    "甲炕":"甲烷","乙炕":"乙烷","丙炕":"丙烷","煤炕":"煤层","甲坑":"甲烷",
    "瓦丝":"瓦斯","瓦嘶":"瓦斯","瓦斯":"瓦斯",
    "粉炭":"粉尘","粉糖":"粉尘","粉生":"粉尘",
    "放跑":"放炮","爆做":"爆破","暴破":"爆破",
    "做业":"作业","作来":"作业","作亚":"作业",
    "应极":"应急","应及":"应急",
    "隐换":"隐患","隐憨":"隐患","隐愚":"隐患",
    "俩治":"治理","两治":"治理","治埋":"治理",
    "装要":"装药","港道":"巷道","干石":"矸石","忙巷":"盲巷",
    "致宰":"致灾","致灾":"致灾","防沿":"防治","防预":"预防",
    "掘采":"采掘","采区":"采区","采煤":"采煤","采掘":"采掘",
    "回风":"回风","进风":"进风","通风":"通风","压风":"压风",
    "掘进":"掘进","掘金":"掘进","支护":"支护","支炉":"支护",
    "煤与瓦斯":"煤与瓦斯","瓦斯突出":"瓦斯突出",
    // ===== 通用字 =====
    "没备":"设备","没施":"设施","设旋":"设施","仪气":"仪器","气本":"气体",
    "传劫":"传动","传动":"传动","传功":"传动",
    "采以":"采用","彩取":"采取","采的":"采取",
    "管哩":"管理","管里":"管理","管埋":"管理","管力":"管理",
    "保章":"保障","保碍":"保障",
    "应相":"影响","应响":"影响","影晌":"影响",
    "范气":"废气","法体":"法律","法规":"法规",
    "专丈":"专门","传门":"专门","级另":"级别",
    "合做":"合作","合治":"合作","事古":"事故","事帮":"事故",
    "账本":"账目","账薄":"账目","危睑":"危险","危验":"危险",
    "本生":"本身","本米":"本来","限在":"现在","性制":"性质",
    "工做":"工作","工助":"工作","是法":"是否","明列":"明确","明如":"明确",
    "完求":"完成","完应":"完成","立到":"立刻","立及":"立即",
    "要于":"在于","要下":"以下","人命":"人民","人只":"人民",
    "生产":"生产","生会":"生活","培认":"培训",
    "应向":"应当","题国":"题目","答安":"答案",
    "选顶":"选项","策咯":"策略","策如":"措施","防方":"防范","防措":"防范",
    "体中":"体制","体可":"体系","制变":"制度","规础":"规程","准侧":"准则",
    "经本":"文本","义不容辞":"义不容辞","不容辞":"不容辞",
    "关千":"关于","干于":"关于","必须":"必须","必项":"必须","项须":"必须",
    "通和":"通知","通过":"通过","过程":"过程","程中":"过程中",
    "及该":"及时","该时":"及时","时候":"时候","时间":"时间","时问":"时间",
    "如果":"如果","如采":"如果","其中":"其中","其申":"其中",
    "分为":"分为","份为":"分为","部分":"部分","部今":"部分",
    "下列":"下列","下例":"下列","以上":"以上","以匕":"以上",
    "正确的是":"正确的是","正确":"正确","正碓":"正确","确":"正确",
    "错误":"错误","错铝":"错误","解析":"解析","解柝":"解析",
    "答案":"答案","答安":"答案","作答":"作答",
    // ===== 数字/字母类 =====
    "O%":"0%","0X":"0%","Ox":"0%","O\/100":"0/100",
    "om":"cm","Om":"Cm","O0":"00","O6":"06","O8":"08","O9":"09",
    "O1":"01","O2":"02","O3":"03","O4":"04","O5":"05","O7":"07"
  };
  // 应用错别字纠正
  function fixCommonOCRErrors(text) {
    if (!text) return text;
    var s = String(text);
    // 字典替换（最长的先匹配）
    var keys = Object.keys(OCR_TYPO_FIXES).sort(function(a,b){return b.length - a.length;});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = OCR_TYPO_FIXES[k];
      if (s.indexOf(k) >= 0 && k !== v) {
        s = s.split(k).join(v);
      }
    }
    // 常见错字正则修正
    // 甲炕 → 甲烷 (炕/烷 形近)
    s = s.replace(/([甲乙丙丁])炕/g, "$1烷");
    // 防控 → 防控
    s = s.replace(/防控/g, "防控");
    // 0/100 等纯数字行：若 OCR 误识别为 O/100，保留
    s = s.replace(/O\/100/g, "0/100");
    return s;
  }
  // 暴露
  window.__SB.fixCommonOCRErrors = fixCommonOCRErrors;
  var NOISE_WORDS = [
    // 通用 App/页面噪声
    "考试宝", "考试吧", "背题", "语音", "搜题",
    "分享", "收藏", "已做题", "关注公众号",
    "扫码", "扫一扫", "AI深", "AI浅", "官方", "微信", "客服",
    "分享到", "分享给", "更多资料", "下载", "更多", "app", "官方app",
    // 做题界面专用
    "答题卡", "限时已过", "限时", "答题结果", "正确答案", "您的回答",
    "答案解析", "上一题", "下一题", "交卷", "题型",
    "展开", "历史", "错题", "答题", "作答", "查看答案", "本题",
    "批改", "重做", "重置", "进度", "剩余", "已用", "倒计时",
    "考试", "练习", "作答", "模考", "我的", "返回", "考题",
    "重命名", "清空", "导出", "导入",
    // 题型标签【独立成行】才剔除（见 isNoiseLine 里的逻辑）
    "单选", "多选", "判断题", "填空题", "简答题"
  ];
  // 结构性"独立成行"才会被剔除的题型标签（和 NOISE_WORDS 配合，见 isNoiseLine）
  var STANDALONE_LABELS = ["单选", "多选", "判断题", "填空题", "简答题", "不项选择", "材料题", "案例分析", "不定项", "不定项选择题"];
  // 结构化噪声
  var NOISE_REGEXES = [
    /^https?:\/\//i,
    /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
    /^第\s*\d+\s*页/i,
    /^\d{4}[\.\-/]\d{1,2}[\.\-/]\d{1,2}/,
    /^\s*[\d.,:：、\-()（）\s]+\s*$/,           // 纯符号数字
    /^\s*[\W_]+\s*$/,                          // 全非字母数字
    /^题型[:：]/,
    /^岗位[:：]/
  ];

  function isNoiseLine(s) {
    if (!s || s.length <= 1) return true;
    for (var i = 0; i < NOISE_REGEXES.length; i++) {
      if (NOISE_REGEXES[i].test(s)) return true;
    }
    for (var j = 0; j < NOISE_WORDS.length; j++) {
      if (s.indexOf(NOISE_WORDS[j]) >= 0) {
        // 【v2.7】题型标签（单选/多选/判断题等）只在"独立成行"时才算噪声
        // 独立成行 = 该行去除前后空格后 == 标签本身（含"单选 2、"这种 标签+题号前缀 仍算题干行）
        if (STANDALONE_LABELS.indexOf(NOISE_WORDS[j]) >= 0) {
          var t = s.replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
          // 必须整行就是题型标签（如"单选"或"单选 2、"或"单选 2."），否则是题干行保留
          if (t === NOISE_WORDS[j] || /^[\u4e00-\u9fa5]+\s*\d{1,3}\s*[、.．:：]?\s*$/.test(t) && t.indexOf(NOISE_WORDS[j]) === 0) {
            return true;
          }
          // 行内有更多内容（题干关键字 / 题号 + 题干 / 选项文字）→ 不是噪声
          continue;
        }
        return true;
      }
    }
    // 检测 "X/Y"（题号进度行）："1/20"、"11/30" 等孤立短行
    if (/^\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/.test(s)) return true;
    // 检测纯题库标题行：题库(4):... 或 题库（4）：...
    if (/^题库\s*[（(]\s*\d+\s*[）)]\s*[:：]/.test(s)) return true;
    return false;
  }

  // 注意：以下正则表达式已全部**直接内联使用**，不要命名为 var 引用并跨闭包使用。
  // iOS WKWebView（JSC）在某些页面对 IIFE 内的 var 声明存在 TDZ 优化，
  // 会抛 "Can't find variable: QMARK / STEM_TRIG / STEM_NUM" 之类的报错。全部内联即可规避。
  // 1) 问号/中文问号            → /[?？]/
  // 2) 题面末尾括号/问号/句号   → /[）\)]\s*[、。.,]?\s*$|[?？]\s*$/
  // 3) 题干关键词               → /(下列|关于|请|以下|哪一?|不属|不属于|属于|说法|表述|指出|根据|依据|符合)/
  // 4) 题号 "16、"/"16."         → /^\s*\d{1,3}\s*[、.]\s*\S/
  // 5) 选项起始（A./A、/A:）     → /^\s*[A-Da-d]\s*[.、:：]\s*\S|^[A-Da-d]\s+[^\s]/
  // 6) 括号空位（（）结尾）      → /[（(]\s*[）)]\s*$/

  /**
   * 把识别结果处理成"更适合搜题"的文本。
   * 主要适配两种界面：
   *  A) "题号 + 题面 + 选项"（如 题库 16、…）
   *  B) "做题界面"（题型 + 题面 + A./B./C. 选项）
   */
  function extractQuestionText(raw) {
    if (!raw) return { stem: "", raw: "" };
    // Vision 在移动端小屏上常常把多块文本拼到一起不换行，先尝试按常见分隔符拆
    var lineList;
    if (/\n/.test(raw)) {
      lineList = String(raw).replace(/\r\n?/g, "\n").split("\n");
    } else {
      lineList = String(raw)
        // 题号 "16、" 前插换行
        .replace(/(\s|^)(\d{1,3}\s*[、.]\s*[^\s])/g, "\n$2")
        // A./B./C./D. 前插换行（含 A选项 也包含）
        .replace(/(\s|^)([A-Da-d])[\.、:：]\s*/g, "\n$2. ")
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

    // 找出所有"选项起点"位置：以 A./B./C./D. 开头
    var optionIdx = [];
    for (var oi = 0; oi < cleaned.length; oi++) {
      // v2.8 选项起点扩展：除 ".、:：" 外，识别顿号"、"，以及"AB、"双字母+顿号"格式
      // 例："A. 10" / "A、10" / "A 10" / "A、D. 提高..."  / "AB、xxx" 都能识别
      if (/^\s*[A-Da-d]\s*[.、:：]\s*\S|^[A-Da-d]\s+[^\s]|^[A-Da-d][、]\s*\S/.test(cleaned[oi])) optionIdx.push(oi);
    }
    // 选项必须连续不间断，否则视为噪声跳过
    var firstOpt = optionIdx.length ? optionIdx[0] : -1;
    var lastOpt  = optionIdx.length ? optionIdx[optionIdx.length - 1] : -1;
    var optionCountOk = (lastOpt - firstOpt + 1) === optionIdx.length && optionIdx.length >= 2;

    // 找"题面起点"
    // 规则（按优先级）：
    //   1) 题面候选 = firstOpt 之前的最后一段连续非噪声文本
    //      且该段最后一行的尾部是 "（）/）/？/?/。" 中的一个
    //   2) 失败：firstOpt 之前的整段
    //   3) 再失败：无选项时用题号/关键词触发
    var stem = "";
    if (optionCountOk) {
      // 题面 = 第一个选项之前的若干行（通常 1-2 行）
      var stemStart = 0;
      // 跳过首行如果是题库标题行 / 题号进度行（已在 isNoiseLine 剔除）
      // 截到第一个选项行之前
      var stemEnd = firstOpt;
      // 往前看 1-3 行，合并成题面
      // 如果 firstOpt 之前的行含 "题干关键词" 或 "题号" 或以"（）结尾"，就取那一行；否则向前合并相邻的中文行
      for (var pi = firstOpt - 1; pi >= 0; pi--) {
        var prev = cleaned[pi];
        if (/(下列|关于|请|以下|哪一?|不属|不属于|属于|说法|表述|指出|根据|依据|符合)/.test(prev) ||
            /^\s*\d{1,3}\s*[、.]\s*\S/.test(prev) ||
            /[（(]\s*[）)]\s*$/.test(prev) ||
            /[。！？\?\)）]$/.test(prev)) {
          stemStart = pi;
          break;
        }
      }
      // 至少取到 firstOpt 之前那一行（如果有内容）
      if (stemStart > 0) {
        // 题面是从 stemStart 开始到 firstOpt-1（不含选项）
        stem = cleaned.slice(stemStart, firstOpt).join("\n");
      } else if (firstOpt > 0) {
        stem = cleaned.slice(0, firstOpt).join("\n");
      } else {
        // 选项从第 0 行开始——说明没识别到题面（或整张图只有选项）
        stem = cleaned[lastOpt].replace(/^[A-D][.、]\s*/, "");
      }
      // 加选项 ABCD
      stem += "\n" + cleaned.slice(firstOpt, lastOpt + 1).join("\n");
    } else {
      // 没有可靠选项；退化用关键词触发
      var stemStart2 = -1;
      for (var k = 0; k < cleaned.length; k++) {
        var line = cleaned[k];
        if (/(下列|关于|请|以下|哪一?|不属|不属于|属于|说法|表述|指出|根据|依据|符合)/.test(line) ||
            /[?？]/.test(line) ||
            /^\s*\d{1,3}\s*[、.]\s*\S/.test(line)) {
          stemStart2 = k;
          break;
        }
      }
      if (stemStart2 >= 0) {
        var stopAt = cleaned.length;
        // 截断：遇到含典型页脚噪声词的就停
        for (var tt = stemStart2 + 1; tt < cleaned.length; tt++) {
          if (/分享|收藏|已做题|考试宝|真题|app/i.test(cleaned[tt]) && tt > stemStart2 + 1) { stopAt = tt; break; }
        }
        stem = cleaned.slice(stemStart2, stopAt).join("\n");
      } else {
        // 最后兜底：取清理后所有非噪声文字
        stem = cleaned.join("\n");
      }
    }

    // v2.8 错别字纠正：Vision OCR 容易把形近字混淆（炕/烷、设/没、的/地/得 等），
    // 在提炼前后做一次纠正，避免搜题时关键词命中错
    if (typeof fixCommonOCRErrors === "function") {
      stem = fixCommonOCRErrors(stem);
    }
    var cleanedRaw = cleaned.join("\n");
    if (typeof fixCommonOCRErrors === "function") {
      cleanedRaw = fixCommonOCRErrors(cleanedRaw);
    }

    return { stem: stem, raw: cleanedRaw };
  }

  /**
   * v2.6 增量：从一段自由文本（可能是 OCR 残留 / 用户手贴）中剔除 ABCD 选项，
   * 只保留首个选项行之前的部分。返回剥离后的字符串；如果没识别到选项，原样返回。
   * 实现细节：
   *   - 先按常见分隔符拆行
   *   - 每行 trim 后做噪声剔除
   *   - 从头找到第一行匹配 "A./B./C./D." 选项起点时，截断
   *   - 若没有匹配上选项则返回原文本
   */
  function stripOptions(text) {
    if (!text) return "";
    var lines = String(text)
      .replace(/\r\n?/g, "\n")
      // 兜底：把没有换行的选项也拆出来
      .replace(/(\s|^)([A-Da-d])[\.、:：]\s*/g, "\n$2. ")
      .split("\n");
    var kept = [];
    for (var i = 0; i < lines.length; i++) {
      var s = String(lines[i] || "").replace(/[\s\u3000]+/g, " ").trim();
      if (!s) continue;
      // 命中"选项起始"立即结束
      if (/^[A-Da-d]\s*[.、:：]\s*\S|^[A-Da-d]\s+[^\s]/.test(s)) break;
      kept.push(s);
    }
    return kept.length ? kept.join("\n") : String(text);
  }
  window.__SB.stripOptions = stripOptions;

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
          // v2.8 OCR 错别字纠正：原 text 也做一次纠正，搜题 raw 也用纠正版
          if (typeof fixCommonOCRErrors === "function") {
            text = fixCommonOCRErrors(text);
          }
          var ex = window.__SB.extractQuestionText(text);
          // 把全文/清理版挂到原生能力上，UI 可选切换；返回值仍是 string
          // （保持与网页版原 tesseractRecognize 的接口兼容，避免破坏其它调用方）
          window.__SB.__lastOCR = {
            raw:     text,         // OCR 识别原文（已做错别字纠正）
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
