// genicons.js —— 转发到 genicons.py（Pillow 处理源 PNG）。
// 当前源图：E:\桌面\在线考试-01.png（用户在 macOS/Icons 阶段前可自行替换）。
//
// 用法：
//   node genicons.js                    # 用默认源图
//   node genicons.js path/to/icon.png   # 自定义源图
//
// 为什么转 Python：Node 没有原生 PNG 缩放库可用（sharp 安装常失败 on Windows）；
// Pillow 处理 Lanczos 缩放质量稳定。
const { spawnSync } = require("child_process");
const path = require("path");

const PY = process.env.PYTHON || "C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe";
const script = path.join(__dirname, "genicons.py");
const args = [script];
if (process.argv[2]) args.push(process.argv[2]);

const r = spawnSync(PY, args, { stdio: "inherit" });
process.exit(r.status == null ? 1 : r.status);
