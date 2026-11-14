package expo.modules.sakunashield

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Watches which app is in front (and, for browsers, the address bar) and blocks what the user chose.
 * Privacy: nothing is logged or sent anywhere; only a daily block count is stored (ShieldStore).
 */
class ShieldAccessibilityService : AccessibilityService() {
  private var lastUrlCheckAt = 0L
  private var lastBlockAt = 0L

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val e = event ?: return
    val pkg = e.packageName?.toString() ?: return
    if (pkg == packageName || pkg in IGNORED) return
    val now = System.currentTimeMillis()

    // Strict mode: protect the session from being switched off in Settings or by uninstalling.
    if (ShieldStore.strictActive(this, now) && pkg in PROTECTION_SCREENS && mentionsSakuna()) {
      block("Strict mode is on. Sakuna's protection can't be turned off until the session ends.", goBack = true)
      return
    }

    if (!ShieldStore.blockingActive(this)) return
    val config = ShieldStore.config(this)

    if (e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && pkg in config.apps) {
      block("You chose to block this app during focus.", goBack = false)
      return
    }

    if (config.domains.isNotEmpty() && pkg in BROWSERS && now - lastUrlCheckAt > 600) {
      lastUrlCheckAt = now
      val host = currentAddress(pkg)?.let { ShieldStore.normalizeDomain(it) } ?: return
      if (ShieldStore.domainMatches(host, config.domains)) {
        block("You chose to block $host during focus.", goBack = true)
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

  private fun mentionsSakuna(): Boolean {
    val root = rootInActiveWindow ?: return false
    return !root.findAccessibilityNodeInfosByText("Sakuna").isNullOrEmpty()
  }

  companion object {
    private val IGNORED = setOf("com.android.systemui")

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

    // Settings / package-installer screens that could disable or uninstall Sakuna during strict mode.
    private val PROTECTION_SCREENS = setOf(
      "com.android.settings", "com.oplus.settings", "com.coloros.settings", "com.coloros.safecenter",
      "com.oplus.safecenter", "com.miui.securitycenter", "com.samsung.android.settings",
      "com.android.packageinstaller", "com.google.android.packageinstaller", "com.samsung.android.packageinstaller",
    )
  }
}
