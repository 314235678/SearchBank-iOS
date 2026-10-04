/* =====================================================================
 * 用「用户真实的电脑版备份」验证导入链路（不进自动化回归，手动跑）
 * ---------------------------------------------------------------------
 * 为什么需要它：日常回归用的是合成样本。这份脚本直接喂 E:\桌面 里
 * 用户真实导出的 8MB 备份，验证：
 *   ① 8MB 级文件能走「原生暂存 + 分块读取」并完整拼回（不丢字节、不乱码）
 *   ② 11344 条题目全部合并进来
 *   ③ 题库定义（banks）一并合并
 *
 * 用法（备份文件路径可用第一个参数覆盖）：
 *   electron test/verify_real_backup.js
 *   electron test/verify_real_backup.js "D:/某处/备份.json"
 * ===================================================================== */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

const INDEX = path.join(__dirname, "..", "www", "index.html");
const BACKUP = process.argv[2] || "E:/桌面/搜题库备份_2026-10-04.json";

if (!fs.existsSync(BACKUP)) {
  console.log("找不到备份文件：" + BACKUP);
  app.exit(2);
}

const raw = fs.readFileSync(BACKUP);
let expect = null;
try { expect = JSON.parse(raw.toString("utf8")); } catch (e) {
  console.log("备份不是合法 JSON：" + e.message);
  app.exit(2);
}
console.log("备份：" + BACKUP);
console.log("大小：" + (raw.length / 1048576).toFixed(2) + " MB");
console.log("文件内题目：" + (expect.items || []).length + " 条，题库：" + (expect.banks || []).length + " 个");

const b64 = raw.toString("base64");
const CHUNK = 2 * 1024 * 1024;   // 每次传 2MB base64（避免 Node→页面单次传超大字符串）

const js = (code) => win.webContents.executeJavaScript(code, true);

let win = null;
app.whenReady().then(function () {
  win = new BrowserWindow({
    width: 430, height: 932, show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-stub.js"),
      contextIsolation: false,
      nodeIntegration: false
    }
  });

  win.webContents.on("did-finish-load", async function () {
    try {
      await new Promise((r) => setTimeout(r, 400));

      // 1) 把真实备份的字节分批送进页面，拼成 Uint8Array（模拟原生沙盒里的暂存文件）
      await js("window.__STUB.__parts = [];");
      for (let i = 0; i < b64.length; i += CHUNK) {
        const part = b64.slice(i, i + CHUNK);
        await js("window.__STUB.__parts.push(atob(" + JSON.stringify(part) + "));");
      }
      const bytes = await js(`(function(){
        var ps = window.__STUB.__parts; var n = 0, i;
        for (i = 0; i < ps.length; i++) n += ps[i].length;
        var u = new Uint8Array(n); var p = 0;
        for (i = 0; i < ps.length; i++) { for (var j = 0; j < ps[i].length; j++) u[p++] = ps[i].charCodeAt(j); }
        window.__STUB.stagedBytes = u;
        window.__STUB.__parts = null;
        return u.length;
      })()`);
      console.log("已送入页面字节：" + bytes + "（原始 " + raw.length + "）");
      console.log("字节数一致：" + (bytes === raw.length ? "是" : "否 ✗"));

      // 2) 走完整导入流程
      const before = await js("DATA.items.length");
      const banksBefore = await js("(DATA.banks||[]).length");
      await js(`window.__STUB.pickFilesResult = [{ name: ${JSON.stringify(path.basename(BACKUP))}, mime: "application/json", staged: true, size: ${raw.length} }];`);
      const logBefore = await js("window.__STUB_LOG.filter(function(x){return x.type==='readImportChunk';}).length");

      await js(`document.getElementById('btnImport').click();`);

      // 等确认弹窗出现
      let up = false;
      for (let t = 0; t < 200 && !up; t++) {
        up = await js(`(function(){var m=document.getElementById('mask');return !!(m&&m.classList.contains('on'));})()`);
        if (!up) await new Promise((r) => setTimeout(r, 100));
      }
      console.log("确认弹窗出现：" + (up ? "是" : "否 ✗"));
      const dialogText = await js(`(document.getElementById('mBody')||{}).textContent`);
      console.log("弹窗文案：" + dialogText);

      await js(`(function(){var m=document.getElementById('mask');var b=m.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='确定'){b[i].click();return;}}})()`);
      await new Promise((r) => setTimeout(r, 400));

      const after = await js("DATA.items.length");
      const banksAfter = await js("(DATA.banks||[]).length");
      const chunkCalls = (await js("window.__STUB_LOG.filter(function(x){return x.type==='readImportChunk';}).length")) - logBefore;

      console.log("\n---------- 结果 ----------");
      console.log("分块读取次数：" + chunkCalls);
      console.log("题目：" + before + " → " + after + "（净增 " + (after - before) + "，期望 " + expect.items.length + "）");
      console.log("题库：" + banksBefore + " → " + banksAfter);
      const okItems = (after - before) === expect.items.length;

      // 3) 抽查中文是否完好 + 归属完整性
      //    注意字段名：题干是 `q`、答案是 `a`、选项是 `opts`、归属是 `bankId`
      //    （不是 stem/ans/options —— 首版脚本就猜错了，比对全成了 undefined）
      const lastQ = await js("DATA.items[DATA.items.length-1].q");
      const firstImported = await js("DATA.items[" + before + "].q");
      const midImported = await js("DATA.items[" + (before + Math.floor(expect.items.length / 2)) + "].q");
      const expLast = String(expect.items[expect.items.length - 1].q || "");
      const expFirst = String(expect.items[0].q || "");
      const expMid = String(expect.items[Math.floor(expect.items.length / 2)].q || "");
      const ckFirst = firstImported === expFirst;
      const ckMid = midImported === expMid;
      const ckLast = lastQ === expLast;
      console.log("首条题干逐字一致：" + (ckFirst ? "是" : "否 ✗"));
      console.log("中段题干逐字一致：" + (ckMid ? "是" : "否 ✗"));
      console.log("末条题干逐字一致：" + (ckLast ? "是" : "否 ✗"));
      if (!ckFirst) {
        console.log("  实际前 60 字：" + String(firstImported).slice(0, 60));
        console.log("  期望前 60 字：" + expFirst.slice(0, 60));
      }

      // 归属完整性：导入进来的每条题目，其 bankId 都必须在（合并后的）题库里存在，
      // 否则管理页会出现「归属未知」的悬空题目。
      const orphan = await js(`(function(){
        var ids = {}; (DATA.banks||[]).forEach(function(b){ ids[b.id] = 1; });
        var bad = 0, sample = "";
        for (var i = ${before}; i < DATA.items.length; i++) {
          var bid = DATA.items[i].bankId;
          if (bid && !ids[bid]) { bad++; if (!sample) sample = bid; }
        }
        return bad + (sample ? "|" + sample : "");
      })()`);
      const orphanN = parseInt(String(orphan).split("|")[0], 10);
      console.log("悬空归属题目数：" + orphanN + (orphanN ? "（示例 bankId=" + String(orphan).split("|")[1] + "）" : ""));

      const pageErrors = await js("JSON.stringify(window.__PAGE_ERRORS||[])");
      console.log("页面错误：" + pageErrors);

      const allOk = okItems && ckFirst && ckMid && ckLast && orphanN === 0 &&
                    pageErrors === "[]" && chunkCalls > 1;
      console.log("\n" + (allOk ? "REAL_BACKUP_OK" : "REAL_BACKUP_FAIL"));
      app.exit(allOk ? 0 : 1);
    } catch (e) {
      console.log("验证脚本失败：" + (e && e.message));
      app.exit(1);
    }
  });

  win.loadFile(INDEX);
});
