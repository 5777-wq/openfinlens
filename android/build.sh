#!/usr/bin/env bash
# build.sh —— OpenFinLens 安卓壳构建脚本（无 Gradle / 无 Android Studio）
# 工具链（全部免安装，_android/toolchain/ 内，勿提交）：
#   jdk17.zip            Temurin JDK 17（TUNA 镜像）
#   aapt2.zip            aapt2 windows（阿里云 google maven 镜像）
#   r8.jar               D8 dexer（同上）
#   android-33.jar       编译平台 jar（Sable/android-platforms）
#   uber-apk-signer.jar  对齐+签名+校验（patrickfav/uber-apk-signer）
# 用法：cd android && bash build.sh
set -e
cd "$(dirname "$0")"

TC=toolchain
OUT=build
AJAR=$TC/android16.jar   # 编译平台 jar（阿里云镜像 API16；壳只依赖远古 API，targetSdk=29）
rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex" "$OUT/gen"

# 0) 工具链解压
if [ ! -d "$TC/jdk" ]; then
  echo "[0/6] 解压 JDK…"
  mkdir -p "$TC/jdk"
  unzip -q "$TC/jdk17.zip" -d "$TC/jdk"
fi
JDK_BIN=$(ls -d "$TC"/jdk/jdk-*/bin | head -1)
if [ ! -f "$TC/aapt2/aapt2.exe" ]; then
  mkdir -p "$TC/aapt2"
  unzip -q -o "$TC/aapt2.zip" -d "$TC/aapt2"
fi
AAPT2="$TC/aapt2/aapt2.exe"

# 1) 图标（PIL）——已生成则跳过（构建机未必装 PIL，图标入库可复现）
if [ ! -f res/mipmap-xxhdpi/ic_launcher.png ]; then
  python gen_icons.py > /dev/null
fi

# 2) 资源编译 + 链接（生成资源 APK 与 R.java）
echo "[1/6] aapt2 compile/link…"
"$AAPT2" compile --dir res -o "$OUT/res.zip"
"$AAPT2" link -o "$OUT/app.unaligned.apk" -I "$AJAR" \
  --manifest AndroidManifest.xml -R "$OUT/res.zip" --java "$OUT/gen" --auto-add-overlay

# 3) javac（android.jar 为 bootclasspath）
echo "[2/6] javac…"
"$JDK_BIN/javac" -J-Duser.language=en -encoding UTF-8 -source 8 -target 8 -nowarn \
  -classpath "$AJAR" \
  -d "$OUT/classes" src/com/openfinlens/app/*.java "$OUT/gen/com/openfinlens/app/R.java" > "$OUT/javac.log" 2>&1
rc=$?
if [ $rc -ne 0 ]; then echo "javac failed:"; cat "$OUT/javac.log"; exit 1; fi

# 4) d8 → classes.dex
echo "[3/6] d8 dex…"
"$JDK_BIN/java" -cp "$TC/r8.jar" com.android.tools.r8.D8 --release \
  --min-api 21 \
  --output "$OUT/dex" $(find "$OUT/classes" -name "*.class")

# 5) classes.dex 并入 APK（python zipfile 追加）
echo "[4/6] 打包…"
python - <<'PY'
import zipfile
src = "build/app.unaligned.apk"
dst = "build/app.apk"
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
    for it in zin.infolist():
        if it.filename == "classes.dex":
            continue
        zout.writestr(it, zin.read(it.filename))
with zipfile.ZipFile(dst, "a", zipfile.ZIP_DEFLATED) as z:
    z.write("build/dex/classes.dex", "classes.dex")
print("packed", dst)
PY

# 6) 对齐 + 签名 + 校验（uber-apk-signer 一步完成）
echo "[5/6] 签名…"
if [ ! -f "$TC/debug.keystore" ]; then
  "$JDK_BIN/keytool" -genkeypair -keystore "$TC/debug.keystore" -alias openfinlens \
    -keyalg RSA -keysize 2048 -validity 10000 -storepass openfinlens \
    -dname "CN=OpenFinLens, OU=OpenFinLens, O=OpenFinLens, C=CN" > /dev/null 2>&1
fi
"$JDK_BIN/java" -jar "$TC/uber-apk-signer.jar" --apks "$OUT/app.apk" \
  --ks "$TC/debug.keystore" --ksAlias openfinlens --ksPass openfinlens --ksKeyPass openfinlens \
  --overwrite

echo "[6/6] 完成：$OUT/app.apk（已对齐+签名）"
VERSION="${OFL_VERSION:-1.0.2}"
cp "$OUT/app.apk" "OpenFinLens-v${VERSION}.apk"
ls -la "OpenFinLens-v${VERSION}.apk"
