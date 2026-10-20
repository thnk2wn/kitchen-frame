#!/system/bin/sh
# Runs on the frame as root: replaces /system/app/webview (stock 106) with the staged WebView 138,
# keeping the stock tree at /system/kf-stock-webview for undo.sh. Checks hashes before and after
# each step; on a failure after remounting, puts the stock tree back and remounts read-only. It only
# ever deletes the 138 copies it made itself (/system/kf-new-webview, or the 138 tree it had moved into
# place when it has to roll back), never the stock files.
S=/data/local/tmp/kf-webview
LIVE=/system/app/webview
STOCK=/system/kf-stock-webview
NEW=/system/kf-new-webview
CTX=u:object_r:system_file:s0

die() { echo "FAIL: $*"; exit 1; }
check() { (cd "$1" && sha256sum -c "$2" >/dev/null 2>&1); }

[ "$(id -u)" = 0 ] || die "not root"
cd "$S" || die "no staging dir"
sha256sum -c new.sha256 || die "staged files don't match"
check "$LIVE" "$S/stock.sha256" || die "live tree isn't the stock 106 we backed up"
[ -e "$STOCK" ] && die "$STOCK already exists"
[ -e "$NEW" ] && die "$NEW already exists"
[ -e "$NEW.failed" ] && die "$NEW.failed already exists (an earlier failed run): check it by hand"
set -- $(df -k /system | tail -1); free=$4  # no awk on the frame
[ "$free" -gt 250000 ] || die "only ${free} KB free on /system"

mount -o remount,rw /system || die "remount rw failed"
rollback() {
  echo "rolling back: $*"
  # Stock moved aside but not back in place: put it back (moving a failed 138 out of the way first).
  # If a move fails, stop there with /system read-only and say so, rather than nest or lose a tree.
  if [ -d "$STOCK" ]; then
    if [ -e "$LIVE" ]; then
      mv "$LIVE" "$NEW.failed" || { sync; mount -o remount,ro /system; echo "WARNING: couldn't move 138 aside; stock is at $STOCK, put it back by hand"; exit 1; }
    fi
    mv "$STOCK" "$LIVE" || { [ -d "$NEW.failed" ] && mv "$NEW.failed" "$LIVE"; sync; mount -o remount,ro /system; echo "WARNING: couldn't put stock back; it is at $STOCK"; exit 1; }
  fi
  [ -d "$NEW" ] && rm -r "$NEW"
  [ -d "$NEW.failed" ] && rm -r "$NEW.failed"
  sync; mount -o remount,ro /system
  check "$LIVE" "$S/stock.sha256" && echo "stock tree is back in place" || echo "WARNING: stock tree check failed, restore it from the backup taken before the swap"
  exit 1
}

mkdir -p "$NEW/lib/arm" || rollback "mkdir"
cp webview.apk "$NEW/" && cp lib/arm/*.so "$NEW/lib/arm/" || rollback "copy"
chown -R root:root "$NEW" && find "$NEW" -type d -exec chmod 755 {} \; && find "$NEW" -type f -exec chmod 644 {} \; || rollback "perms"
chcon -R "$CTX" "$NEW" || rollback "chcon"
check "$NEW" "$S/new.sha256" || rollback "copy on /system doesn't match"
mv "$LIVE" "$STOCK" || rollback "move stock aside"
mv "$NEW" "$LIVE" || rollback "move new into place"
check "$LIVE" "$S/new.sha256" || rollback "new tree in place doesn't match"
check "$STOCK" "$S/stock.sha256" || rollback "stock tree aside doesn't match"
sync
mount -o remount,ro /system || echo "WARNING: remount ro failed (a reboot mounts it ro anyway)"
ls -laRZ "$LIVE"
echo "OK: WebView 138 in place, stock kept at $STOCK. Reboot to use it."
