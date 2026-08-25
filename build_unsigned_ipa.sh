#!/usr/bin/env bash
#
# build_unsigned_ipa.sh —— 在 macOS 上编译「未签名」的 IPA
#
# 用途：产出可被 AltStore / Sideloadly / esign / TrollStore 等工具
#       用个人 Apple ID（免费或付费）在手机上「自签」安装的 IPA。
# 本脚本不执行任何签名，因此不需要本地证书/描述文件。
#
# 用法（Mac 终端）：
#   cd ios-app
#   bash build_unsigned_ipa.sh
# 产物：当前目录下的 SearchBank.ipa
#
set -euo pipefail

cd "$(dirname "$0")"

echo "==> [1/5] 准备 XcodeGen"
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "    未检测到 xcodegen，尝试 brew install xcodegen ..."
  brew install xcodegen
fi

echo "==> [2/5] 生成 Xcode 工程"
xcodegen generate

echo "==> [3/5] 编译并归档（CODE_SIGNING_ALLOWED=NO，跳过签名）"
rm -rf build
xcodebuild archive \
  -project SearchBank.xcodeproj \
  -scheme SearchBank \
  -archivePath build/SearchBank.xcarchive \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  OTHER_CODE_SIGN_FLAGS="--timestamp=none" \
  ONLY_ACTIVE_ARCH=NO \
  ARCHS="arm64" \
  VALID_ARCHS="arm64" \
  ENABLE_BITCODE=NO

APP_PATH="build/SearchBank.xcarchive/Products/Applications/SearchBank.app"
if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: 编译产物未找到：$APP_PATH"
  exit 1
fi

echo "==> [4/5] 打包为未签名 IPA（Payload/SearchBank.app）"
rm -rf Payload SearchBank.ipa
mkdir -p Payload
cp -R "$APP_PATH" Payload/

# 清除任何残留签名/描述文件，保证是干净的无签名 IPA
rm -rf "Payload/SearchBank.app/_CodeSignature" 2>/dev/null || true
rm -f  "Payload/SearchBank.app/embedded.mobileprovision" 2>/dev/null || true
rm -f  "Payload/SearchBank.app/CodeResources" 2>/dev/null || true
# 确保可执行文件权限正确
chmod +x "Payload/SearchBank.app/SearchBank" 2>/dev/null || true

# IPA 本质是一个 zip
zip -r -y SearchBank.ipa Payload >/dev/null

echo "==> [5/5] 完成"
IPA_SIZE=$(du -h SearchBank.ipa | cut -f1)
echo "    产物：SearchBank.ipa （${IPA_SIZE}，未签名）"
echo "    下一步：用 AltStore / Sideloadly / esign / TrollStore 在手机上自签安装。"
