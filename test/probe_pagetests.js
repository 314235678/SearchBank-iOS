/* 临时探针：直接把 e2e_mobile.js 里的 PAGE_TESTS 抽出来单独执行，
   拿到真实的行数与异常（E2E 报的 "Script failed to execute" 太笼统） */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

const INDEX = path.join(__dirname, "..", "www", "index.html");
const TESTSRC = path.join(__dirname, "e2e_mobile.js");

const s = fs.readFileSync(TESTSRC, "utf8");
const i = s.indexOf("const PAGE_TESTS = `");
const j = s.indexOf("\n`;", i);
const RAW_BODY = s.slice(i + "const PAGE_TESTS = `".length, j);
/* ⚠️ 关键：必须按**模板字符串**求值，不能直接当文本用。
   直接切片会把 `\\n`、`\\d` 原样留在源码里，页面解析后就成了"字面反斜杠"，
   于是换行不分行、正则也匹配不上 —— 会造出一堆假失败。 */
const PAGE_TESTS = new Function("return `" + RAW_BODY + "`;")();
console.log("PAGE_TESTS 长度 " + PAGE_TESTS.length
  + "（原始 " + RAW_BODY.length + "，模板求值后应更短）");

let win = null;
app.whenReady().then(function () {
  win = new BrowserWindow({
    width: 430, height: 932, show: false,
    webPreferences: { preload: path.join(__dirname, "preload-stub.js"), contextIsolation: false, nodeIntegration: false }
  });
  win.webContents.on("console-message", function (a, b, c) {
    const lvl = (typeof b === "object" && b) ? b.level : b;
    const msg = (typeof b === "object" && b) ? b.message : c;
    console.log("   [console:" + lvl + "] " + msg);
  });
  win.webContents.on("did-finish-load", function () {
    setTimeout(function () {
      win.webContents.executeJavaScript(PAGE_TESTS, true).then(function (res) {
        console.log("\n============ PAGE_TESTS 直接执行结果 ============");
        console.log("  rows 数 = " + (res && res.rows ? res.rows.length : "(无)"));
        if (res && res.rows) {
          res.rows.filter(function (r) { return !r.pass; }).forEach(function (r) {
            console.log("  ✗ " + r.name + "  [" + r.extra + "]");
          });
        }
        console.log("  页面错误 = " + JSON.stringify((res && res.errors) || []));
        app.exit(0);
      }).catch(function (e) {
        console.log("\n============ PAGE_TESTS 抛错 ============");
        console.log("  message: " + (e && e.message));
        console.log("  stack: " + (e && e.stack ? String(e.stack).split("\n").slice(0, 6).join("\n         ") : "(无)"));
        console.log("  JSON: " + JSON.stringify(e && e.constructor && e.constructor.name));
        app.exit(1);
      });
    }, 500);
  });
  win.loadFile(INDEX);
});
