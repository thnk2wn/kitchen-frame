#!/bin/bash
# Builds KitchenFrameBridge.app (a background app, no Dock icon) into bridge/mac/build/.
# Needs Apple's command line tools: xcode-select --install
set -euo pipefail
cd "$(dirname "$0")"
command -v swiftc >/dev/null || { echo "swiftc not found. Install Apple's command line tools: xcode-select --install" >&2; exit 1; }
app=build/KitchenFrameBridge.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp Info.plist "$app/Contents/Info.plist"
# The frame's mark from its boot animation (icon/make-icon.sh), shown in System Settings and Finder.
mkdir -p "$app/Contents/Resources" && cp AppIcon.icns "$app/Contents/Resources/AppIcon.icns"
swiftc -O -swift-version 5 -framework EventKit -framework Photos -framework AppKit KitchenFrameBridge.swift -o "$app/Contents/MacOS/KitchenFrameBridge"

# Signed with the same certificate every build, so macOS keeps its permissions (Reminders, Calendar,
# Photos, Full Disk Access) across rebuilds: it knows an app by its identifier and certificate, and an
# ad-hoc signature is new each time. The certificate is self-signed, made here once, and kept in its
# own keychain (with a random password beside it) so signing never needs your login password.
signing="$HOME/Library/Application Support/KitchenFrameBridge/signing"
kc="$signing/signing.keychain-db"
if [ ! -f "$kc" ]; then
  mkdir -p "$signing" && chmod 700 "$signing"
  tmp=$(mktemp -d)
  printf '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Kitchen Frame Bridge signing\n[ext]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n' > "$tmp/c.cnf"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/k.pem" -out "$tmp/c.pem" -days 36500 -config "$tmp/c.cnf" 2>/dev/null
  openssl pkcs12 -export -inkey "$tmp/k.pem" -in "$tmp/c.pem" -out "$tmp/c.p12" -passout pass:import -name "Kitchen Frame Bridge signing" 2>/dev/null
  (umask 077; openssl rand -hex 24 > "$signing/keychain.pass")
  security create-keychain -p "$(cat "$signing/keychain.pass")" "$kc"
  security unlock-keychain -p "$(cat "$signing/keychain.pass")" "$kc"
  security import "$tmp/c.p12" -k "$kc" -P import -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$(cat "$signing/keychain.pass")" "$kc" >/dev/null
  openssl x509 -in "$tmp/c.pem" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d : > "$signing/fingerprint"
  rm -rf "$tmp"
  echo "Made a signing certificate (once): macOS asks for permissions once more, then keeps them across rebuilds."
fi
security unlock-keychain -p "$(cat "$signing/keychain.pass")" "$kc"
# codesign finds the certificate only in a keychain on the search list: add it just for this, then
# put the list back as it was.
searched=()
while IFS= read -r line; do line="${line#"${line%%[![:space:]]*}"}"; line="${line#\"}"; searched+=("${line%\"}"); done < <(security list-keychains -d user)
restore() { security list-keychains -d user -s "${searched[@]}"; }
trap restore EXIT
security list-keychains -d user -s "$kc" "${searched[@]}"
codesign --force --keychain "$kc" --sign "$(cat "$signing/fingerprint")" "$app"
restore
trap - EXIT
echo "Built $app"
