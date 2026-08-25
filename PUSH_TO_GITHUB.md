# 把 ios-app 推到 GitHub（仅 Windows，无 Mac）

> 目标：推到 GitHub 后，由 GitHub 的 **macOS 构建机**自动编译出「未签名 IPA」，
> 你在手机上用 AltStore / Sideloadly / esign / TrollStore 自签安装。
>
> ⚠️ 注意：WorkBuddy 的沙箱**连不上 github.com**。下面的 `git push` 必须在你**自己的
> Windows 终端（Git Bash / PowerShell，能上外网）**里执行，不要在 WorkBuddy 里跑。

---

## 第 1 步：网页上新建仓库（GitHub.com）

1. 登录 https://github.com → 右上角 **+** → **New repository**。
2. Repository name 填 `SearchBank-iOS`（或你喜欢的名字）。
3. 选 **Private**（私有，推荐）或 Public。
4. **不要**勾选 "Add a README file" / ".gitignore" / "license"（我们代码里已经有了）。
5. 点 **Create repository**。
6. 创建后页面会显示仓库地址，形如 `https://github.com/<你的用户名>/SearchBank-iOS.git`，复制它。

---

## 第 2 步：生成 Personal Access Token（PAT，当作 git 密码用）

GitHub 已不支持用账号密码 push，必须用 token：

1. GitHub 右上角头像 → **Settings** → 左侧 **Developer settings** → **Personal access tokens** → **Tokens (classic)**。
2. **Generate new token (classic)**。
3. Note 填 `searchbank-ios`，Expiration 选 30 days（或你需要的时长）。
4. 勾选 **repo**（全选该分组即可）。
5. 点 **Generate token**，**立刻复制**那一长串 `ghp_...`（只显示一次！）。

---

## 第 3 步：在你自己的 Windows 终端里推送

打开 **Git Bash**（或 PowerShell），执行：

```bash
# 进入项目目录（就是本文件所在目录）
cd "E:/workbuddy/2026-08-25-11-39-00/ios-app"

# 本地仓库已经由助手初始化并提交好；如你从头开始则先执行：
#   git init
#   git add -A
#   git commit -m "SearchBank iOS app"

# 关联远程仓库（把 <用户名> 和 <仓库名> 换成你自己的）
git branch -M main
git remote add origin https://github.com/<你的用户名>/SearchBank-iOS.git

# 推送（推送时会要求输入用户名和密码）
git push -u origin main
```

**push 时的登录方式（重要）：**
- **Username**：填你的 GitHub 用户名。
- **Password**：**粘贴第 2 步生成的 PAT**（不是你的 GitHub 登录密码）。
  - Git Bash 里粘贴可能不会显示字符，正常，回车即可。
  - 若提示 "Support for password authentication was removed"，说明你填成了登录密码——改用 PAT。

> 嫌每次输入麻烦，可把 token 写进远程地址（一次性，注意别把含 token 的命令发到公开地方）：
> ```bash
> git remote set-url origin https://<你的用户名>:<你的PAT>@github.com/<你的用户名>/SearchBank-iOS.git
> git push -u origin main
> ```

---

## 第 4 步：让 GitHub Actions 编译 IPA

1. 回到仓库页面 → 顶部 **Actions** 标签。
2. 左侧看到 **Build Unsigned IPA** 工作流；若未自动跑，点进去 → **Run workflow** → 确认运行。
3. 等几分钟（macOS 构建机需安装 xcodegen + 编译，约 2–5 分钟）。
4. 完成后在 **该次运行页面底部 → Artifacts** 下载 `SearchBank-unsigned-ipa`（即 `SearchBank.ipa`）。

---

## 第 5 步：手机上自签安装

拿到 `SearchBank.ipa`（未签名）后，见 `README.md` 第九节：
- AltStore / Sideloadly / esign / TrollStore 任一工具，用你的 Apple ID 自签。
- 免费 Apple ID 有效期约 7 天，到期重签一次即可（数据保留）。
- Bundle ID 建议改成你自己的唯一标识（详见 README 九）。

---

## 常见问题

- **push 报 `Could not connect to server`**：说明你仍在 WorkBuddy 沙箱里执行。请在自己能上外网的 Windows 终端执行。
- **`remote origin already exists`**：先 `git remote remove origin` 再重新 `git remote add`。
- **token 泄露**：立即去 GitHub → Settings → Developer settings → 撤销该 token，重新生成。
