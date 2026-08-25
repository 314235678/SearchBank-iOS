// 把网页版 搜题平台.html 包装为 iOS 工程内的 www/index.html：
// 在 </body> 前注入桥接脚本 app-bridge.js（网页其余逻辑、样式、功能完全保留）。
const fs = require("fs");
const path = require("path");

const SRC = "E:/workbuddy/2026-08-23-17-55-30/搜题平台.html";
const OUT = path.join(__dirname, "www", "index.html");

let html = fs.readFileSync(SRC, "utf8");

const inject = '<script src="app-bridge.js"></script>\n';
if (!html.includes("app-bridge.js")) {
  // 插到【最后一个】</body> 之前（页面真正的闭合标签），
  // 避免误伤网页内「导出 Word」字符串模板里出现的 </body>
  const idx = html.lastIndexOf("</body>");
  if (idx >= 0) {
    html = html.slice(0, idx) + inject + html.slice(idx);
  } else {
    html += inject;
  }
} else {
  console.log("已包含 app-bridge.js，跳过注入");
}

fs.writeFileSync(OUT, html, "utf8");
console.log("written", OUT, "(", (Buffer.byteLength(html) / 1024).toFixed(0), "KB )");
