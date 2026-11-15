package expo.modules.sakunashield

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import java.util.Locale

/**
 * Watches which app is in front (and, for browsers, the address bar) and blocks what the active blocklists say.
 * Privacy: nothing is logged or sent anywhere; only a daily block count is stored (ShieldStore).
 */
class ShieldAccessibilityService : AccessibilityService() {
  private var lastUrlCheckAt = 0L
  private var lastShortsCheckAt = 0L
  private var lastShortsToastAt = 0L
  private var lastBlockAt = 0L
  private var browsers: Set<String> = emptySet()
  private var browsersCheckedAt = 0L
  private val installTimes = HashMap<String, Long>()

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val e = event ?: return
    val pkg = e.packageName?.toString() ?: return
    if (pkg == packageName || pkg in IGNORED) return
    val now = System.currentTimeMillis()
    val windowChanged = e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED

    // Strict Mode: protect the shield from being switched off in Settings or by uninstalling.
    if (ShieldStore.strictActive(this, now) && pkg in PROTECTION_SCREENS && mentionsSakuna()) {
      block("Strict Mode is on. Sakuna's protection can't be turned off until it ends.", goBack = true)
      return
    }

    val active = ShieldStore.activeLists(this, now)
    if (active.isEmpty()) return

    if (windowChanged) {
      val list = active.firstOrNull { pkg in it.apps }
      if (list != null) { block("“${list.name}” is blocking this app right now.", goBack = false); return }

      // Newly installed apps join the list that asked for it, then get blocked.
      active.firstOrNull { it.newApps && isNewSince(pkg, it.newAppsSince) }?.let { l ->
        ShieldStore.addApp(this, l.id, pkg)
        block("New app added to “${l.name}” and blocked.", goBack = false)
        return
      }

      if (pkg == PLAY_STORE && active.any { it.purchases } && isPurchaseScreen(e.className?.toString())) {
        block("In-app purchases are blocked right now.", goBack = true)
        return
      }

      if (pkg !in BROWSERS && active.any { it.unsupportedBrowsers && it.hasWebRules } && pkg in browserPackages(now)) {
        block("This browser can't be checked, so it's blocked while website rules are on.", goBack = false)
        return
      }
    }

    // Short videos inside apps: leave the Shorts / Reels player, keep the rest of the app usable.
    if (pkg in SHORT_FORM && active.any { it.shorts } && now - lastShortsCheckAt > 500) {
      lastShortsCheckAt = now
      if (inShortForm(pkg)) {
        performGlobalAction(GLOBAL_ACTION_BACK)
        if (now - lastShortsToastAt > 4000) {
          lastShortsToastAt = now
          ShieldStore.countBlock(this)
          Toast.makeText(this, if (pkg == YOUTUBE) "Shorts are blocked. The rest of YouTube is fine." else "Reels are blocked right now.", Toast.LENGTH_SHORT).show()
        }
        return
      }
    }

    val webLists = active.filter { it.hasWebRules }
    if (webLists.isNotEmpty() && pkg in BROWSERS && now - lastUrlCheckAt > 600) {
      lastUrlCheckAt = now
      val text = currentAddress(pkg)?.lowercase(Locale.ROOT) ?: return
      val host = ShieldStore.normalizeDomain(text)
      for (l in webLists) {
        val reason = when {
          ShieldStore.domainMatches(host, l.domains) -> "“${l.name}” is blocking $host."
          l.keywords.any { text.contains(it) } -> "“${l.name}” blocks pages with this keyword."
          l.adult && AdultFilter.matches(host, text) -> "Adult sites are blocked."
          else -> null
        }
        if (reason != null) { block(reason, goBack = true); return }
      }
    }
  }

  override fun onInterrupt() {}

  private fun block(reason: String, goBack: Boolean) {
    val now = System.currentTimeMillis()
    performGlobalAction(if (goBack) GLOBAL_ACTION_BACK else GLOBAL_ACTION_HOME)
    if (now - lastBlockAt < 1500) return // one block screen per burst of events
    lastBlockAt = now
    ShieldStore.countBlock(this)
    startActivity(
      Intent(this, BlockActivity::class.java)
        .putExtra(BlockActivity.EXTRA_REASON, reason)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
    )
  }

  /** A launchable app first installed after `since`. Install times are cached; updates don't change them. */
  private fun isNewSince(pkg: String, since: Long): Boolean {
    if (since <= 0L || ShieldStore.wasAutoAdded(this, pkg)) return false
    val installed = installTimes.getOrPut(pkg) {
      try {
        if (packageManager.getLaunchIntentForPackage(pkg) == null) 0L
        else packageManager.getPackageInfo(pkg, 0).firstInstallTime
      } catch (_: PackageManager.NameNotFoundException) { 0L }
    }
    return installed > since
  }

  /** Google Play's payment sheet. Class names vary by Play version, so this is a best-effort match. */
  private fun isPurchaseScreen(className: String?): Boolean {
    val c = className?.lowercase(Locale.ROOT) ?: return false
    return PURCHASE_HINTS.any { c.contains(it) }
  }

  /** Every app that opens ordinary web links (refreshed every 5 minutes). */
  private fun browserPackages(now: Long): Set<String> {
    if (now - browsersCheckedAt > 5 * 60_000L) {
      browsersCheckedAt = now
      val view = Intent(Intent.ACTION_VIEW, Uri.parse("http://example.com")).addCategory(Intent.CATEGORY_BROWSABLE)
      @Suppress("DEPRECATION")
      browsers = packageManager.queryIntentActivities(view, PackageManager.MATCH_ALL).map { it.activityInfo.packageName }.toSet() - packageName
    }
    return browsers
  }

  /** Text of the browser's address bar, if it can be found. */
  private fun currentAddress(pkg: String): String? {
    val root = rootInActiveWindow ?: return null
    for (id in ADDRESS_BAR_IDS) {
      val nodes: List<AccessibilityNodeInfo> = root.findAccessibilityNodeInfosByViewId("$pkg:id/$id") ?: continue
      val text = nodes.firstNotNullOfOrNull { it.text?.toString()?.takeIf { value -> value.isNotBlank() } }
      if (text != null) return text
    }
    return null
  }

  /** True when the Shorts / Reels player is on screen (matched by the apps' own view ids; best effort, apps change them). */
  private fun inShortForm(pkg: String): Boolean {
    val root = rootInActiveWindow ?: return false
    val ids = SHORT_FORM[pkg] ?: return false
    return ids.any { id -> !root.findAccessibilityNodeInfosByViewId("$pkg:id/$id").isNullOrEmpty() }
  }

  private fun mentionsSakuna(): Boolean {
    val root = rootInActiveWindow ?: return false
    return !root.findAccessibilityNodeInfosByText("Sakuna").isNullOrEmpty()
  }

  companion object {
    private const val PLAY_STORE = "com.android.vending"
    private const val YOUTUBE = "com.google.android.youtube"
    private val SHORT_FORM = mapOf(
      YOUTUBE to listOf("reel_player_page_container", "reel_recycler", "reel_watch_player", "shorts_player_container", "reel_time_bar"),
      "com.instagram.android" to listOf("clips_viewer_view_pager", "clips_viewer_container", "clips_video_container"),
    )
    private val IGNORED = setOf("com.android.systemui")
    private val PURCHASE_HINTS = listOf("billing", "acquire", "iabv3", "purchase")

    private val BROWSERS = setOf(
      "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary",
      "org.mozilla.firefox", "org.mozilla.firefox_beta", "org.mozilla.focus",
      "com.microsoft.emmx", "com.brave.browser", "com.opera.browser", "com.opera.mini.native",
      "com.sec.android.app.sbrowser", "com.heytap.browser", "com.coloros.browser", "com.android.browser",
      "com.duckduckgo.mobile.android", "com.vivaldi.browser", "com.mi.globalbrowser", "com.kiwibrowser.browser",
    )

    private val ADDRESS_BAR_IDS = listOf(
      "url_bar", "url_field", "search_box_text", "location_bar_edit_text", "mozac_browser_toolbar_url_view",
      "url", "address_bar_edit_text", "sbrowser_url_bar", "edit_text", "omnibarTextInput",
    )

    // Settings / package-installer screens that could disable or uninstall Sakuna during Strict Mode.
    private val PROTECTION_SCREENS = setOf(
      "com.android.settings", "com.oplus.settings", "com.coloros.settings", "com.coloros.safecenter",
      "com.oplus.safecenter", "com.miui.securitycenter", "com.samsung.android.settings",
      "com.android.packageinstaller", "com.google.android.packageinstaller", "com.samsung.android.packageinstaller",
    )
  }
}
