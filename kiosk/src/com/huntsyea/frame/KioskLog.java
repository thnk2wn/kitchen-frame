package com.huntsyea.frame;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.InputStreamReader;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The kiosk's own log, kept on storage so it survives a power-off (1.13): Android's own log on this
 * frame is memory only, gone at every power-up, and it keeps no crash memory either. Each line has
 * Android's boot count, so a boot the kiosk never reached shows as a gap in the counts.
 *
 * At its first start in a boot it also keeps Android's own warnings and errors from then on (logcat,
 * as root, into LOGCAT_DIR), and moves the previous boot's to prev/. The page asks once per app
 * start for startReport(): this start, the previous run's last lines, and the previous boot's last
 * Android errors (dashboard/src/lib/checkin.js sends them with the check-in).
 */
final class KioskLog {
  static final String TAG = "FrameKiosk";
  private static final long MAX_BYTES = 64 * 1024; // then kiosk.log becomes kiosk.log.1
  private static final int PREVIOUS_LINES = 12;
  private static final int ANDROID_LINES = 10;
  private static final String LOGCAT_DIR = "/data/local/tmp/kf-logcat";

  private static File file;
  private static int bootCount = -1;
  private static volatile String report = null; // null until ready; "" once the page has it
  private static final SimpleDateFormat when = new SimpleDateFormat("MM-dd HH:mm:ss", Locale.US);

  /** Opens the log and starts this start's report (the root parts off the main thread). */
  static synchronized void start(Context c) {
    file = new File(c.getFilesDir(), "kiosk.log");
    bootCount = Settings.Global.getInt(c.getContentResolver(), "boot_count", -1);
    SharedPreferences p = c.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE);
    final int lastBoot = p.getInt("log.boot", -1);
    p.edit().putInt("log.boot", bootCount).apply();
    final List<String> previousRun = lastRun();
    final boolean sameBoot = bootCount == lastBoot;
    final int missed = lastBoot >= 0 && bootCount > lastBoot + 1 ? bootCount - lastBoot - 1 : 0;
    final long sinceBoot = SystemClock.elapsedRealtime() / 1000;
    add("I", "start: boot " + bootCount + (sameBoot ? " (app restart)" : "") + ", " + sinceBoot + " s after power-up"
        + (missed > 0 ? ", " + missed + " boot(s) since the last start never reached the kiosk" : ""));
    new Thread(() -> {
      List<String> android = new ArrayList<>();
      // Root isn't ready for a while after a power-up (19 s in, su failed): wait for it, up to 3 minutes.
      for (int i = 0; i < 36 && !root("id").contains("uid=0"); i++) SystemClock.sleep(5000);
      if (!sameBoot) {
        // The previous boot's Android log becomes prev/, and this boot's starts (it carries on
        // through app restarts, so only once a boot).
        root("mkdir -p " + LOGCAT_DIR + " && rm -rf " + LOGCAT_DIR + "/prev && { [ -d " + LOGCAT_DIR + "/cur ] && mv "
            + LOGCAT_DIR + "/cur " + LOGCAT_DIR + "/prev; mkdir " + LOGCAT_DIR + "/cur; }");
      }
      // [t]: the pattern mustn't match the shell running pgrep, whose own command line holds it.
      if (root("pgrep -f 'logcat -v threadtime .*kf-logca[t]/cur/log'").trim().isEmpty()) {
        root("nohup logcat -v threadtime -b main,system,crash -f " + LOGCAT_DIR + "/cur/log -r 256 -n 2 '*:W' >/dev/null 2>&1 &");
      }
      if (!sameBoot) {
        for (String l : root("cat " + LOGCAT_DIR + "/prev/log.1 " + LOGCAT_DIR + "/prev/log 2>/dev/null | grep -E '^[0-9-]+ [0-9:.]+ +[0-9]+ +[0-9]+ [EF] ' | tail -n " + ANDROID_LINES).split("\n")) {
          if (!l.trim().isEmpty()) android.add(l.trim());
        }
      }
      try {
        JSONObject r = new JSONObject();
        r.put("boot", bootCount);
        r.put("sameBoot", sameBoot);
        r.put("missedBoots", missed);
        r.put("sinceBootS", sinceBoot);
        r.put("zygoteS", seconds(prop("ro.boottime.zygote")));
        r.put("bootanimS", seconds(prop("ro.boottime.bootanim")));
        r.put("previousRun", new JSONArray(previousRun));
        r.put("previousBoot", new JSONArray(android));
        report = r.toString();
      } catch (Exception e) {
        report = "{}";
      }
    }, "kiosk-log").start();
  }

  /** The report once ready, and only once: later page loads in the same run get "{}". */
  static synchronized String takeReport() {
    if (report == null) return "{\"pending\":true}";
    String r = report;
    report = "{}";
    return r;
  }

  /** A line in Android's log and in the kiosk's own. */
  static synchronized void add(String level, String msg) {
    if ("W".equals(level)) Log.w(TAG, msg); else Log.i(TAG, msg);
    if (file == null) return;
    String line = when.format(new Date()) + " up" + SystemClock.elapsedRealtime() / 1000 + "s b" + bootCount + " " + level + " " + msg + "\n";
    try {
      if (file.length() > MAX_BYTES) file.renameTo(new File(file.getPath() + ".1"));
      try (FileOutputStream out = new FileOutputStream(file, true)) { out.write(line.getBytes("UTF-8")); }
    } catch (Exception e) {
      Log.w(TAG, "kiosk log: " + e);
    }
  }

  /** The previous run's last lines: those after the last "start:" line. */
  private static List<String> lastRun() {
    List<String> run = new ArrayList<>();
    for (File f : new File[] {new File(file.getPath() + ".1"), file}) {
      if (!f.exists()) continue;
      try (BufferedReader in = new BufferedReader(new FileReader(f))) {
        for (String l; (l = in.readLine()) != null;) {
          if (l.contains(" start: ")) run.clear();
          run.add(l);
        }
      } catch (Exception e) {
        Log.w(TAG, "kiosk log: " + e);
      }
    }
    return run.size() > PREVIOUS_LINES ? new ArrayList<>(run.subList(run.size() - PREVIOUS_LINES, run.size())) : run;
  }

  private static String root(String cmd) {
    try {
      Process p = Runtime.getRuntime().exec(new String[] {"su", "-c", cmd});
      StringBuilder out = new StringBuilder();
      try (BufferedReader in = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
        for (String l; (l = in.readLine()) != null;) out.append(l).append('\n');
      }
      p.waitFor();
      return out.toString();
    } catch (Exception e) {
      Log.w(TAG, "kiosk log: " + cmd.split(" ")[0] + ": " + e);
      return "";
    }
  }

  private static String prop(String name) {
    try {
      Process p = Runtime.getRuntime().exec(new String[] {"getprop", name});
      try (BufferedReader in = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
        String l = in.readLine();
        return l == null ? "" : l.trim();
      }
    } catch (Exception e) {
      return "";
    }
  }

  // ro.boottime.* are nanoseconds after power-up.
  private static double seconds(String ns) {
    try { return Math.round(Long.parseLong(ns) / 1e8) / 10.0; } catch (Exception e) { return -1; }
  }
}
