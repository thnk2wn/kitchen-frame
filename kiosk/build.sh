#!/usr/bin/env bash
# Builds the kiosk APK (kiosk/build/frame.apk) with the plain Android SDK command-line tools.
#
# Requirements: JDK 17, Android build-tools 34.0.0 and platform android-34, e.g. on macOS:
#   brew install openjdk@17 && brew install --cask android-commandlinetools
#   sdkmanager --sdk_root="$ANDROID_HOME" "build-tools;34.0.0" "platforms;android-34"
# Then:  ./build.sh && adb install -r build/frame.apk
set -euo pipefail

VERSION_NAME=1.7
VERSION_CODE=8
MIN_SDK=23
TARGET_SDK=27

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here" # relative paths below, so a space in the project path is harmless
sdk="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
tools="$sdk/build-tools/34.0.0"
platform="$sdk/platforms/android-34/android.jar"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:$PATH"

for need in "$tools/aapt2" "$tools/d8" "$tools/zipalign" "$tools/apksigner" "$platform"; do
  [ -e "$need" ] || { echo "Missing $need (see the requirements at the top of this script)" >&2; exit 1; }
done

out=build
rm -rf "$out"
mkdir -p "$out/classes"

# 1. Resources and manifest -> an unsigned APK skeleton.
"$tools/aapt2" link --manifest AndroidManifest.xml -I "$platform" -o "$out/unsigned.apk" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME"

# 2. Java -> class files -> classes.dex, added to the APK.
sources=(); while IFS= read -r f; do sources+=("$f"); done < <(find src -name '*.java')
javac -nowarn --release 8 -classpath "$platform" -d build/classes "${sources[@]}"
classes=(); while IFS= read -r f; do classes+=("$f"); done < <(find build/classes -name '*.class')
"$tools/d8" --min-api "$MIN_SDK" --lib "$platform" --output build "${classes[@]}"
(cd "$out" && zip -q unsigned.apk classes.dex)

# 3. Align, then sign with the local debug key (created on first use).
"$tools/zipalign" -f 4 "$out/unsigned.apk" "$out/aligned.apk"
keystore="$HOME/.android/debug.keystore"
if [ ! -f "$keystore" ]; then
  mkdir -p "$(dirname "$keystore")"
  keytool -genkeypair -keystore "$keystore" -alias androiddebugkey -storepass android -keypass android \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
"$tools/apksigner" sign --ks "$keystore" --ks-pass pass:android --key-pass pass:android \
  --out "$out/frame.apk" "$out/aligned.apk"

echo "Built kiosk/build/frame.apk ($VERSION_NAME)"
