package com.huntsyea.frame;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.http.SslError;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
 * Escape hatch: hold two fingers still on the screen for 2 seconds.
 *
 * This frame has no battery-backed clock: every power-up starts in 2008, and Android's own time
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
  static final float ESCAPE_SLOP_PX = 60;

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
        return false; // stay inside the kiosk
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
    if (url == null) url = getSharedPreferences(PREFS, MODE_PRIVATE).getString("url", null);
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
    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("url", url).apply();
    handler.removeCallbacks(retry);
    loadedOnce = false;
    handler.removeCallbacks(watchdog);
    handler.postDelayed(watchdog, WATCHDOG_MS);
    return true;
  }

  /** Window brightness 0.02–1, or below 0 to follow the system setting. Only while the kiosk is in front. */
  private void applyBrightness(float level) {
    WindowManager.LayoutParams lp = getWindow().getAttributes();
    lp.screenBrightness = level < 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : Math.max(0.02f, Math.min(1f, level));
    getWindow().setAttributes(lp);
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

    @JavascriptInterface
    public float getBrightness() {
      return getSharedPreferences(PREFS, MODE_PRIVATE).getFloat("brightness", -1f);
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
  private void fixClock() {
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
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("MMddHHmmyyyy.ss", java.util.Locale.US);
        f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        Process p = Runtime.getRuntime().exec(new String[] {"su", "-c", "date -u " + f.format(new java.util.Date(date))});
        int rc = p.waitFor();
        Log.i(TAG, "clock: set from Date header, su exit " + rc + ", now " + new java.util.Date());
        if (!clockWrong()) handler.post(() -> { handler.removeCallbacks(retry); if (!loadedOnce && url != null) web.loadUrl(url); });
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
        if (e.getPointerCount() == 2) {
          for (int i = 0; i < 2; i++) { downX[i] = e.getX(i); downY[i] = e.getY(i); }
          escapeArmed = true;
          handler.postDelayed(escape, ESCAPE_HOLD_MS);
        } else {
          cancelEscape();
        }
        break;
      case MotionEvent.ACTION_MOVE:
        if (escapeArmed && e.getPointerCount() >= 2) {
          for (int i = 0; i < 2; i++) {
            if (Math.hypot(e.getX(i) - downX[i], e.getY(i) - downY[i]) > ESCAPE_SLOP_PX) { cancelEscape(); break; }
          }
        }
        break;
      case MotionEvent.ACTION_POINTER_UP:
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL:
        cancelEscape();
        break;
      default:
        break;
    }
    return super.dispatchTouchEvent(e);
  }

  private void cancelEscape() {
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
