/* 临时探针：真实渲染一次搜索结果，量出卡片各部分的宽度，定位「题干被挤窄」
   到底是谁占走了宽度 */
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

  // 造一道长题干、带分类与多选项的题，走真实搜索渲染
  const it = DATA.items.find(function(x){ return x.q && x.q.length > 40; }) || DATA.items[0];
  if (!it) { p("题库为空", ""); return out; }
  DATA.items.unshift({
    id: "probe_layout", q: "带式输送机输送带入井前应经过什么试验？这是一道用来测版面的长题干，故意写长一点看它怎么换行。",
    a: "B", opts: [{label:"A",text:"强度试验"},{label:"B",text:"阻燃试验"},{label:"C",text:"耐磨试验"},{label:"D",text:"防水试验"}],
    type: "单选题", cat: "第一部分", bankId: it.bankId || "default", note: "", src: "测试", createdAt: Date.now()
  });
  go("search");
  setSearchText("带式输送机输送带入井前应经过什么试验");
  doSearch();
  await new Promise(r => setTimeout(r, 1500));

  const box = document.getElementById("searchResults");
  p("视口宽度", window.innerWidth + " × " + window.innerHeight);
  p("结果容器宽", box ? Math.round(box.getBoundingClientRect().width) : "无");

  const card = box && box.querySelector(".qcard");
  if (!card) { p("没渲染出卡片", box ? box.innerHTML.slice(0, 200) : ""); return out; }
  p("卡片宽", Math.round(card.getBoundingClientRect().width));
  p("卡片内边距", getComputedStyle(card).padding);

  const qh = card.querySelector(".qh");
  if (qh) {
    const cs = getComputedStyle(qh);
    p(".qh display", cs.display + " / wrap=" + cs.flexWrap);
    p(".qh 宽", Math.round(qh.getBoundingClientRect().width));
    p(".qh 直接子元素数", qh.children.length);
    Array.prototype.forEach.call(qh.children, function (c, i) {
      const r = c.getBoundingClientRect();
      const ccs = getComputedStyle(c);
      p("   子[" + i + "] <" + c.tagName.toLowerCase() + " class='" + (c.className||"") + "'>",
        "宽=" + Math.round(r.width) + " flex=" + ccs.flexGrow + "/" + ccs.flexShrink + "/" + ccs.flexBasis
        + " 文本=" + JSON.stringify((c.textContent||"").slice(0, 18)));
    });
  }

  // 选项行布局
  const opt = card.querySelector(".opt");
  if (opt) {
    const orr = opt.getBoundingClientRect();
    const ocs = getComputedStyle(opt);
    p(".opt 宽=" + Math.round(orr.width), "display=" + ocs.display + " flex=" + ocs.flex);
    const lab = opt.querySelector(".opt-label");
    if (lab) p("   .opt-label 宽", Math.round(lab.getBoundingClientRect().width));
    const txt = opt.querySelector(".opt-text") || opt.children[1];
    if (txt) p("   .opt 文本节点宽", Math.round(txt.getBoundingClientRect().width));
  }

  p("", "");
  p("卡片 HTML（前 700 字）", "");
  out.push(card.outerHTML.slice(0, 700));
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
        console.log("\n============ 结果卡片布局探针 ============");
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
