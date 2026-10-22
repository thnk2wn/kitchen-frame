package com.huntsyea.frame;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlarmManager;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.http.SslError;
import android.net.Uri;
import android.os.Bundle;
import android.os.Debug;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;

/**
 * Full-screen kiosk for the family dashboard.
 *
 * Set or change the dashboard URL over ADB (remembered across reboots):
 *   adb shell am start -n com.huntsyea.frame/.MainActivity -d 'https://example.workers.dev/?key=...'
 * Remote debugging (chrome://inspect) only while launched with:  --ez debug true
 * Escape hatch: hold two (or more) fingers still on the screen for 2 seconds.
 *
 * This frame has no battery-backed clock (no clock chip on the board): every power-up starts on a
 * stale time, usually 2008, sometimes an earlier boot's (days behind), and Android's own time
 * sync takes a minute and a half, so the first HTTPS loads fail with a certificate error. On such
 * an error with the clock plainly wrong, the kiosk reads the time from a plain-HTTP Date header
 * and sets the clock as root (su), then loads again. Without root it falls back to waiting for
 * Android. Every failure, SSL included, schedules a retry, and a watchdog reloads if the page
 * has never finished loading. Until the page loads, a line of status text says what it's waiting on.
 *
 * The page can set the screen brightness through window.FrameKiosk (see Bridge); the value is
 * kept here so it applies from the moment the app starts, before the page has loaded.
 */
public class MainActivity extends Activity {
  static final String TAG = "FrameKiosk";
  static final String PREFS = "kiosk";
  static final long RETRY_MS = 10000;
  static final long WATCHDOG_MS = 30000;
  static final long ESCAPE_HOLD_MS = 2000;
  static final float ESCAPE_SLOP_PX = 120; // a firm press spreads and shifts the finger's contact point

  private final Handler handler = new Handler(Looper.getMainLooper());
  private WebView web;
  private String url;
  private final float[] downX = new float[2];
  private final float[] downY = new float[2];
  private boolean escapeArmed;
  private boolean loadedOnce;
  private TextView status;
  private volatile boolean settingClock;
  private long clockTriedAt;
  private static final long BOOT_CHECK_MS = 10 * 60 * 1000; // "just after a power-up"
  private static final long CLOCK_SLACK_MS = 60 * 1000;

  // The frame often starts before Wi-Fi is up: keep retrying the dashboard until it loads.
  private final Runnable retry = new Runnable() {
    @Override public void run() { if (url != null) { Log.i(TAG, "retrying load"); web.loadUrl(url); } }
  };

  // Belt and braces: whatever went wrong, keep trying until the dashboard has loaded once.
  private final Runnable watchdog = new Runnable() {
    @Override public void run() {
      if (!loadedOnce && url != null) { Log.w(TAG, "watchdog: never loaded, reloading"); web.loadUrl(url); }
      handler.postDelayed(this, WATCHDOG_MS);
    }
  };

  private final Runnable escape = new Runnable() {
    @Override public void run() {
      escapeArmed = false;
      new AlertDialog.Builder(MainActivity.this)
          .setTitle("Frame")
          .setItems(new String[] {"Reload dashboard", "Android settings"}, (d, which) -> {
            if (which == 0) web.reload();
            else startActivity(new Intent(Settings.ACTION_SETTINGS));
          })
          .setNegativeButton("Close", null)
          .show();
    }
  };

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    web = new WebView(this);
    web.setBackgroundColor(Color.BLACK);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true); // the dashboard keeps its key and last data in localStorage
    s.setMediaPlaybackRequiresUserGesture(false); // timer chimes must sound without a tap first
    s.setUseWideViewPort(true);   // honour <meta name="viewport" content="width=1280">
    s.setLoadWithOverviewMode(true);
    s.setSupportZoom(false);
    // The dashboard is https; Home Assistant on the home network is plain http (ws://). Without
    // this, WebView blocks the page from reaching it as mixed content.
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return request.isForMainFrame() && offDashboard(request.getUrl());
      }

      // Android 6 and 7.0 call this one instead (the one above is API 24+): top-level loads only.
      @Override
      @SuppressWarnings("deprecation")
      public boolean shouldOverrideUrlLoading(WebView view, String to) {
        return offDashboard(Uri.parse(to));
      }

      @Override
      public void onPageFinished(WebView view, String finished) {
        // The built-in error page also "finishes"; only count a real page with a title.
        if (view.getTitle() != null && !view.getTitle().isEmpty() && !view.getTitle().startsWith("Webpage")) {
          loadedOnce = true;
          status.setVisibility(View.GONE);
          handler.removeCallbacks(retry);
          Log.i(TAG, "loaded " + view.getTitle());
        }
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) {
          Log.w(TAG, "load error " + error.getErrorCode() + " " + error.getDescription());
          if (!loadedOnce) status.setText("Waiting for the network…");
          scheduleRetry();
        }
      }

      @Override
      public void onReceivedSslError(WebView view, SslErrorHandler sslHandler, SslError error) {
        // Never bypass certificate checks; just try again (the clock is probably still syncing).
        Log.w(TAG, "ssl error " + error.getPrimaryError() + " (device time " + new java.util.Date() + ")");
        sslHandler.cancel();
        if (clockWrong()) { if (!loadedOnce) status.setText("Setting the clock…"); fixClock(); }
        scheduleRetry();
      }
    });
    web.addJavascriptInterface(new Bridge(), "FrameKiosk");
    applyBrightness(getSharedPreferences(PREFS, MODE_PRIVATE).getFloat("brightness", -1f));
    status = new TextView(this);
    status.setTextColor(0xff8e8e93);
    status.setTextSize(20);
    status.setText("Starting…");
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);
    root.addView(web);
    FrameLayout.LayoutParams at = new FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER_HORIZONTAL | Gravity.BOTTOM);
    at.bottomMargin = 64;
    root.addView(status, at);
    setContentView(root);

    handleIntent(getIntent());
    handler.postDelayed(measureMemory, 20000); // memory for the check-in, off the page's thread
    if (url == null) {
      url = getSharedPreferences(PREFS, MODE_PRIVATE).getString("url", null);
      // Kiosks before 1.6 saved the whole setup link, key and Home Assistant token included. Load it
      // as it is this once (the page saves what it needs), and keep only the address from now on.
      if (url != null && (url.contains("?") || url.contains("#"))) getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("url", withoutQuery(url)).apply();
    }
    // Just after a power-up the clock can also come back days behind, not in 2008 (seen 2026-10-22:
    // two days, until Android's sync a minute and a half later): check it against the server once.
    if (SystemClock.elapsedRealtime() < BOOT_CHECK_MS) fixClock(true);
    if (url != null) { web.loadUrl(url); handler.postDelayed(watchdog, WATCHDOG_MS); }
    else web.loadData("<body style='background:#000;color:#999;font:24px sans-serif;padding:48px'>"
        + "No dashboard URL set. Set one over ADB:<br><br><code>adb shell am start -n "
        + "com.huntsyea.frame/.MainActivity -d &lt;url&gt;</code></body>", "text/html", "utf-8");
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    if (handleIntent(intent)) web.loadUrl(url);
  }

  /** Applies the debug flag and, when the intent carries a URL, saves it. True if the URL changed. */
  private boolean handleIntent(Intent intent) {
    WebView.setWebContentsDebuggingEnabled(intent != null && intent.getBooleanExtra("debug", false));
    Uri data = intent == null ? null : intent.getData();
    if (data == null) return false;
    url = data.toString();
    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("url", withoutQuery(url)).apply();
    handler.removeCallbacks(retry);
    loadedOnce = false;
    handler.removeCallbacks(watchdog);
    handler.postDelayed(watchdog, WATCHDOG_MS);
    return true;
  }

  /**
   * The dashboard's address without its query: the setup link carries the dashboard key and the
   * Home Assistant token, which the page keeps in its own storage, so the kiosk needn't (and
   * shouldn't) keep a copy. After a wipe of the page's storage, run the setup link again.
   */
  static String withoutQuery(String u) {
    // The setup link carries the key and token after # since 1.10 (after ? before): neither is kept.
    int q = u.indexOf('?'), h = u.indexOf('#');
    int cut = q < 0 ? h : h < 0 ? q : Math.min(q, h);
    return cut < 0 ? u : u.substring(0, cut);
  }

  /** Window brightness 0.02–1, or below 0 to follow the system setting. Only while the kiosk is in front. */
  private void applyBrightness(float level) {
    WindowManager.LayoutParams lp = getWindow().getAttributes();
    lp.screenBrightness = level < 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : Math.max(0.02f, Math.min(1f, level));
    getWindow().setAttributes(lp);
  }

  private static final long MEMORY_MS = 5 * 60 * 1000;
  private volatile String memoryJson = "{}";
  private final Runnable measureMemory = new Runnable() {
    @Override public void run() {
      new Thread(() -> memoryJson = readMemory(), "kiosk-memory").start();
      handler.postDelayed(this, MEMORY_MS);
    }
  };

  /** See Bridge.getMemory. Slow (reads the process's memory map): never on the UI or page thread. */
  private String readMemory() {
    try {
      Debug.MemoryInfo mi = new Debug.MemoryInfo();
      Debug.getMemoryInfo(mi);
      ActivityManager.MemoryInfo sys = new ActivityManager.MemoryInfo();
      ((ActivityManager) getSystemService(ACTIVITY_SERVICE)).getMemoryInfo(sys);
      long up = android.os.Build.VERSION.SDK_INT >= 24 ? SystemClock.elapsedRealtime() - android.os.Process.getStartElapsedRealtime() : -1;
      return "{\"pss\":" + mi.getTotalPss() / 1024
          + ",\"native\":" + mi.nativePss / 1024
          + ",\"java\":" + mi.dalvikPss / 1024
          + ",\"avail\":" + sys.availMem / (1024 * 1024)
          + ",\"total\":" + sys.totalMem / (1024 * 1024)
          + ",\"low\":" + sys.lowMemory
          + ",\"upMin\":" + (up < 0 ? -1 : up / 60000)
          + ",\"bootMin\":" + SystemClock.elapsedRealtime() / 60000 + "}";
    } catch (Exception e) { return "{}"; }
  }

  /**
   * Stay inside the kiosk, and on the dashboard: a top-level page on another host would get the
   * window.FrameKiosk bridge too (2026-10-20 security review). Embeds (YouTube) aren't top-level. A
   * redirect to another host (a new custom domain, a sign-in page) is refused the same way, so change
   * the kiosk's address with the setup link instead.
   */
  private boolean offDashboard(Uri to) {
    if (url == null) return false;
    String host = Uri.parse(url).getHost();
    if (host != null && host.equalsIgnoreCase(to.getHost())) return false;
    Log.w(TAG, "refused a top-level page outside the dashboard: " + to.getHost());
    return true;
  }

  /** Exposed to the dashboard page as window.FrameKiosk. Only our dashboard loads in this WebView. */
  class Bridge {
    @JavascriptInterface
    public void setBrightness(final float level) {
      getSharedPreferences(PREFS, MODE_PRIVATE).edit().putFloat("brightness", level).apply();
      runOnUiThread(() -> applyBrightness(level));
    }

    /** The kiosk app's version, for the page's check-in (dashboard/src/lib/checkin.js). */
    @JavascriptInterface
    public String getVersion() {
      try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
    }

    /**
     * Memory for the page's check-in, as JSON, in MB: pss is this app's total as Android counts it
     * (the WebView runs in this process here, so it's the dashboard's too; the page itself only sees
     * a rounded-off JS heap), native and java its heaps, avail and total the frame's, low whether
     * Android considers memory low, and upMin / bootMin how long the app and the frame have been up.
     * Measured off the page's thread every MEMORY_MS (1.9): Debug.getMemoryInfo reads the process's
     * whole memory map, about 430 ms on the frame, which as a direct call froze the page each check-in.
     */
    @JavascriptInterface
    public String getMemory() {
      return memoryJson;
    }

    /**
     * Restarts the app, WebView and all (1.11; 1.12 for the page to use it): a page reload keeps the process and what it has grown
     * to, a restart starts it fresh. The page asks at night (dashboard/src/lib/checkin.js). An
     * alarm opens the app again a few seconds after this process ends.
     */
    @JavascriptInterface
    public void restartApp() {
      Log.i(TAG, "restart asked for by the page");
      Intent again = new Intent(MainActivity.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
      PendingIntent pi = PendingIntent.getActivity(MainActivity.this, 1, again, PendingIntent.FLAG_CANCEL_CURRENT);
      ((AlarmManager) getSystemService(ALARM_SERVICE)).set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + 3000, pi);
      runOnUiThread(() -> { finishAffinity(); android.os.Process.killProcess(android.os.Process.myPid()); });
    }

    @JavascriptInterface
    public float getBrightness() {
      return getSharedPreferences(PREFS, MODE_PRIVATE).getFloat("brightness", -1f);
    }

    /**
     * The phone app's Screenshot (dashboard/src/lib/screenshot.js): captures the screen as root
     * (screencap sees everything, video and the camera pop-up too, which drawing the page wouldn't),
     * shrinks it to 1280 wide and PUTs it as a JPEG to the dashboard's own Worker. Off the UI thread;
     * the page hears how it went through window.frameShotDone(ok, why).
     *
     * The address is the kiosk's, never the caller's: Android 8's WebView gives this bridge to every
     * frame in the page, embeds (YouTube) included, so one could otherwise send the screen anywhere.
     * The page passes only the dashboard key, which the Worker checks.
     */
    @JavascriptInterface
    public void captureTo(final String auth) {
      final Uri home = url == null ? null : Uri.parse(url);
      new Thread(() -> {
        String why = null;
        try {
          if (home == null || !"https".equals(home.getScheme())) throw new Exception("no dashboard address set");
          upload("https://" + home.getAuthority() + "/api/frame/screenshot", auth, capture());
        } catch (Exception e) {
          why = e.getMessage() != null ? e.getMessage() : e.toString();
          Log.w(TAG, "screenshot: " + why);
        }
        final String js = "window.frameShotDone && window.frameShotDone(" + (why == null) + ", " + org.json.JSONObject.quote(why == null ? "" : why) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
      }, "screenshot").start();
    }
  }

  /** The screen as a JPEG, 1280 wide (plenty to read on a phone, and small on the frame's slow Wi-Fi). */
  static byte[] capture() throws Exception {
    Process p = Runtime.getRuntime().exec(new String[] {"su", "-c", "screencap -p"});
    java.io.ByteArrayOutputStream png = new java.io.ByteArrayOutputStream();
    try (java.io.InputStream in = p.getInputStream()) {
      byte[] buf = new byte[65536];
      for (int n; (n = in.read(buf)) > 0; ) png.write(buf, 0, n);
    }
    int rc = p.waitFor();
    android.graphics.Bitmap full = android.graphics.BitmapFactory.decodeByteArray(png.toByteArray(), 0, png.size());
    if (full == null) throw new Exception("screencap gave no image (su exit " + rc + ")");
    int w = Math.min(1280, full.getWidth()), h = Math.round(full.getHeight() * (w / (float) full.getWidth()));
    android.graphics.Bitmap small = android.graphics.Bitmap.createScaledBitmap(full, w, h, true);
    java.io.ByteArrayOutputStream jpeg = new java.io.ByteArrayOutputStream();
    small.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, jpeg);
    full.recycle();
    small.recycle();
    return jpeg.toByteArray();
  }

  static void upload(String url, String auth, byte[] jpeg) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    try {
      c.setRequestMethod("PUT");
      c.setDoOutput(true);
      c.setConnectTimeout(15000);
      c.setReadTimeout(30000);
      c.setFixedLengthStreamingMode(jpeg.length);
      c.setRequestProperty("Authorization", auth);
      c.setRequestProperty("Content-Type", "image/jpeg");
      try (java.io.OutputStream out = c.getOutputStream()) { out.write(jpeg); }
      int code = c.getResponseCode();
      if (code / 100 != 2) throw new Exception("upload answered " + code);
      Log.i(TAG, "screenshot: uploaded " + jpeg.length + " bytes");
    } finally {
      c.disconnect();
    }
  }

  /** The clock starts at 2008-12-31 on every power-up; anything before 2024 is that, not real. */
  static boolean clockWrong() { return Calendar.getInstance().get(Calendar.YEAR) < 2024; }

  /**
   * Sets the clock from a Date header, read over plain HTTP so no certificate check depends on the
   * time: the dashboard's own host first (it answers http with a redirect, which carries a Date),
   * then Google's connectivity check. Seconds-accurate, which is all certificates need; Android's
   * time sync still runs and refines it. At most one try every 20 seconds.
   */
  private void fixClock() { fixClock(false); }

  /** With onlyIfOff, it's left alone unless more than CLOCK_SLACK_MS out; then the page loads again. */
  private void fixClock(final boolean onlyIfOff) {
    long now = android.os.SystemClock.elapsedRealtime();
    if (settingClock || (clockTriedAt != 0 && now - clockTriedAt < 20000)) return;
    settingClock = true;
    clockTriedAt = now;
    final String host = url == null ? null : Uri.parse(url).getHost();
    new Thread(() -> {
      try {
        long date = 0;
        for (String u : new String[] {host == null ? null : "http://" + host + "/", "http://connectivitycheck.gstatic.com/generate_204"}) {
          if (u == null) continue;
          try {
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setRequestMethod("HEAD");
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.getResponseCode();
            date = c.getDate();
            c.disconnect();
          } catch (Exception e) {
            Log.w(TAG, "clock: no date from " + u + ": " + e);
          }
          if (date > 0) break;
        }
        if (date <= 0) return;
        if (onlyIfOff && Math.abs(date - System.currentTimeMillis()) < CLOCK_SLACK_MS) { Log.i(TAG, "clock: right after boot, within a minute"); return; }
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("MMddHHmmyyyy.ss", java.util.Locale.US);
        f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        Process p = Runtime.getRuntime().exec(new String[] {"su", "-c", "date -u " + f.format(new java.util.Date(date))});
        int rc = p.waitFor();
        Log.i(TAG, "clock: set from Date header, su exit " + rc + ", now " + new java.util.Date());
        if (!clockWrong()) handler.post(() -> { handler.removeCallbacks(retry); if ((onlyIfOff || !loadedOnce) && url != null) web.loadUrl(url); });
      } catch (Exception e) {
        Log.w(TAG, "clock: couldn't set it: " + e);
      } finally {
        settingClock = false;
      }
    }).start();
  }

  private void scheduleRetry() {
    handler.removeCallbacks(retry);
    handler.postDelayed(retry, RETRY_MS);
  }

  /** Watches for the two-finger escape hold. Every touch still reaches the page. */
  @Override
  public boolean dispatchTouchEvent(MotionEvent e) {
    switch (e.getActionMasked()) {
      case MotionEvent.ACTION_POINTER_DOWN:
        // The second finger arms it; a third (a palm, a ghost touch) doesn't cancel it.
        if (!escapeArmed && e.getPointerCount() >= 2) {
          for (int i = 0; i < 2; i++) { downX[i] = e.getX(i); downY[i] = e.getY(i); }
          escapeArmed = true;
          handler.postDelayed(escape, ESCAPE_HOLD_MS);
        }
        break;
      case MotionEvent.ACTION_MOVE:
        if (escapeArmed && e.getPointerCount() >= 2) {
          for (int i = 0; i < 2; i++) {
            if (Math.hypot(e.getX(i) - downX[i], e.getY(i) - downY[i]) > ESCAPE_SLOP_PX) { cancelEscape("moved"); break; }
          }
        }
        break;
      case MotionEvent.ACTION_POINTER_UP:
        // Still held while two fingers stay down (the one lifting is counted in getPointerCount).
        if (e.getPointerCount() - 1 < 2) cancelEscape("lifted");
        break;
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL:
        cancelEscape(e.getActionMasked() == MotionEvent.ACTION_UP ? "lifted" : "cancelled");
        break;
      default:
        break;
    }
    return super.dispatchTouchEvent(e);
  }

  private void cancelEscape(String why) {
    if (escapeArmed) Log.i(TAG, "escape hold " + why + " before 2 s");
    escapeArmed = false;
    handler.removeCallbacks(escape);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      getWindow().getDecorView().setSystemUiVisibility(
          View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
  }

  @Override
  public void onBackPressed() {
    // A Home app has nowhere to go back to.
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    web.destroy();
    super.onDestroy();
  }
}
