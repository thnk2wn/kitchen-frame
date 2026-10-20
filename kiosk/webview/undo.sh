#!/system/bin/sh
# Runs on the frame as root: puts the stock WebView 106 back from /system/kf-stock-webview (kept by
# swap.sh), moving 138 aside to /system/kf-138-webview. Reboot afterwards. If the stock tree is gone,
# push the stock tree you pulled before the swap back instead, or restore the /system image.
S=/data/local/tmp/kf-webview
LIVE=/system/app/webview
STOCK=/system/kf-stock-webview
OLD138=/system/kf-138-webview

die() { echo "FAIL: $*"; exit 1; }
[ "$(id -u)" = 0 ] || die "not root"
(cd "$STOCK" && sha256sum -c "$S/stock.sha256") || die "stock tree at $STOCK missing or doesn't match"
[ -e "$OLD138" ] && die "$OLD138 already exists"

mount -o remount,rw /system || die "remount rw failed"
mv "$LIVE" "$OLD138" || { mount -o remount,ro /system; die "couldn't move 138 aside; nothing changed"; }
# If the stock tree won't go into place, put 138 back so there's always a WebView.
mv "$STOCK" "$LIVE" || { mv "$OLD138" "$LIVE"; sync; mount -o remount,ro /system; die "couldn't move stock into place; 138 put back"; }
(cd "$LIVE" && sha256sum -c "$S/stock.sha256") || echo "WARNING: stock tree in place doesn't match"
sync
mount -o remount,ro /system
echo "OK: stock WebView 106 back in place (138 kept at $OLD138). Reboot to use it."
