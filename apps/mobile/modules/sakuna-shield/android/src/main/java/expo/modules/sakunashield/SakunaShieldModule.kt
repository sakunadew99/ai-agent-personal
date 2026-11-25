package expo.modules.sakunashield

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Calendar
import kotlin.math.max
import kotlin.math.min

/** JS bridge for Sakuna Shield: permissions, blocklists, quick block, Strict Mode and screen-time insights. */
class SakunaShieldModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun fail(message: String?) {
    if (message != null) throw CodedException("ERR_SHIELD", message, null)
  }

  override fun definition() = ModuleDefinition {
    Name("SakunaShield")

    Function("getStatus") { status() }
    Function("openAccessibilitySettings") { openSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS) }
    Function("openUsageAccessSettings") { openSettings(Settings.ACTION_USAGE_ACCESS_SETTINGS) }

    Function("getLists") { ShieldStore.listsJson(ctx) }
    Function("saveList") { json: String -> fail(ShieldStore.saveList(ctx, json)); ShieldStore.listsJson(ctx) }
    Function("deleteList") { id: String -> fail(ShieldStore.deleteList(ctx, id)); ShieldStore.listsJson(ctx) }

    Function("startSession") { minutes: Int, listIds: List<String> ->
      if (minutes < 1 || minutes > ShieldStore.MAX_SESSION_MINUTES) fail("Choose between 1 minute and 12 hours.")
      if (ShieldStore.lists(ctx).isEmpty()) fail("Create a blocklist first.")
      ShieldStore.startSession(ctx, minutes, listIds)
      status()
    }
    Function("endSession") { fail(ShieldStore.endSession(ctx)); status() }

    Function("startStrict") { method: String, minutes: Int -> fail(ShieldStore.startStrict(ctx, method, minutes)); status() }
    Function("requestStrictExit") { ShieldStore.requestStrictExit(ctx); status() }
    Function("endStrict") { fail(ShieldStore.endStrict(ctx)); status() }

    Function("getAppMarks") { ShieldStore.appMarks(ctx) }
    Function("setAppMark") { pkg: String, mark: String -> ShieldStore.setAppMark(ctx, pkg, mark); ShieldStore.appMarks(ctx) }

    AsyncFunction("getInstalledApps") { installedApps() }
    AsyncFunction("getInsights") { daysAgo: Int -> insights(daysAgo.coerceIn(0, 30)) }
    AsyncFunction("getSleepWindow") { daysAgo: Int -> sleepWindow(daysAgo.coerceIn(0, 14)) }
  }

  private fun status(): Map<String, Any?> {
    val now = System.currentTimeMillis()
    val strict = ShieldStore.strictActive(ctx, now)
    return mapOf(
      "accessibility" to accessibilityEnabled(),
      "usageAccess" to usageAccessGranted(),
      "charging" to ShieldStore.isCharging(ctx),
      "sessionActive" to ShieldStore.sessionActive(ctx, now),
      "sessionEndsAt" to ShieldStore.sessionEndsAt(ctx).toDouble(),
      "sessionListIds" to ShieldStore.sessionListIds(ctx).toList(),
      "activeListIds" to ShieldStore.activeLists(ctx, now).map { it.id },
      "strict" to strict,
      "strictMethod" to if (strict) ShieldStore.strictMethod(ctx) else "",
      "strictEndsAt" to ShieldStore.strictEndsAt(ctx).toDouble(),
      "exitAvailableAt" to ShieldStore.exitAvailableAt(ctx).toDouble(),
      "strictBlockedReason" to ShieldStore.strictBlockedReason(ctx, now),
      "blocksToday" to ShieldStore.blocksToday(ctx),
    )
  }

  private fun openSettings(action: String) {
    ctx.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  private fun accessibilityEnabled(): Boolean {
    val expected = ComponentName(ctx, ShieldAccessibilityService::class.java)
    val enabled = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
    return enabled.split(':').any { ComponentName.unflattenFromString(it) == expected }
  }

  private fun usageAccessGranted(): Boolean {
    val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  private fun label(pm: PackageManager, pkg: String): String = try {
    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
  } catch (_: PackageManager.NameNotFoundException) {
    pkg
  }

  /** Groups for the app picker. Android's own category first, then a few well-known apps that don't declare one. */
  private fun category(pm: PackageManager, pkg: String): String {
    KNOWN[pkg]?.let { return it }
    val info = try { pm.getApplicationInfo(pkg, 0) } catch (_: PackageManager.NameNotFoundException) { return "other" }
    return when (info.category) {
      ApplicationInfo.CATEGORY_SOCIAL -> "social"
      ApplicationInfo.CATEGORY_GAME -> "games"
      ApplicationInfo.CATEGORY_VIDEO, ApplicationInfo.CATEGORY_AUDIO -> "entertainment"
      ApplicationInfo.CATEGORY_IMAGE -> "creativity"
      ApplicationInfo.CATEGORY_NEWS -> "news"
      ApplicationInfo.CATEGORY_PRODUCTIVITY -> "productivity"
      ApplicationInfo.CATEGORY_MAPS -> "travel"
      else -> {
        @Suppress("DEPRECATION")
        if (info.flags and ApplicationInfo.FLAG_IS_GAME != 0) "games" else "other"
      }
    }
  }

  private fun installedApps(): List<Map<String, Any>> {
    val pm = ctx.packageManager
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    @Suppress("DEPRECATION")
    val activities = pm.queryIntentActivities(launcher, 0)
    return activities
      .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
      .distinctBy { it.first }
      .filter { it.first != ctx.packageName }
      .sortedBy { it.second.lowercase() }
      .map { mapOf("packageName" to it.first, "label" to it.second, "category" to category(pm, it.first)) }
  }

  /**
   * One day's screen time, worked out on the phone from Android's usage events. Nothing is stored or uploaded.
   * Foreground time per app and per hour, pickups (unlocks), longest screen-on stretch, and the longest
   * phone-free stretch between 06:00 and 23:00 ("longest focus").
   */
  private fun insights(daysAgo: Int): Map<String, Any?> {
    if (!usageAccessGranted()) return mapOf("available" to false)
    val cal = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
      add(Calendar.DAY_OF_YEAR, -daysAgo)
    }
    val start = cal.timeInMillis
    val now = System.currentTimeMillis()
    val wakeStart = start + 6 * HOUR
    val wakeEnd = start + 23 * HOUR
    cal.add(Calendar.DAY_OF_YEAR, 1)
    val end = min(cal.timeInMillis, now)

    val pm = ctx.packageManager
    @Suppress("DEPRECATION")
    val homes = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0).map { it.activityInfo.packageName }.toSet()
    val skip = homes + ctx.packageName + "com.android.systemui"

    val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val events = usm.queryEvents(start - 2 * HOUR, end)
    val ev = UsageEvents.Event()
    val perApp = HashMap<String, Long>()
    val hourly = LongArray(24)
    val hourApps = Array(24) { HashMap<String, Long>() }
    val screenOn = ArrayList<LongArray>()
    var current: String? = null
    var currentStart = 0L
    var screenOnAt = -1L
    var unlocks = 0
    var wakes = 0
    var sawKeyguard = false

    fun close(t: Long) {
      val p = current ?: return
      current = null
      val s = max(currentStart, start)
      val e = min(t, end)
      if (e <= s || p in skip) return
      perApp[p] = (perApp[p] ?: 0L) + (e - s)
      var cursor = s
      while (cursor < e) {
        val hour = ((cursor - start) / HOUR).toInt().coerceIn(0, 23)
        val next = min(e, start + (hour + 1) * HOUR).let { if (it <= cursor) e else it }
        hourly[hour] += next - cursor
        hourApps[hour][p] = (hourApps[hour][p] ?: 0L) + (next - cursor)
        cursor = next
      }
    }
    fun screenPeriod(from: Long, to: Long) {
      val s = max(from, start); val e = min(to, end)
      if (e > s) screenOn.add(longArrayOf(s, e))
    }

    while (events.hasNextEvent()) {
      events.getNextEvent(ev)
      val t = ev.timeStamp
      when (ev.eventType) {
        ACTIVITY_RESUMED -> { close(t); current = ev.packageName; currentStart = t }
        ACTIVITY_PAUSED, ACTIVITY_STOPPED -> if (ev.packageName == current) close(t)
        SCREEN_INTERACTIVE -> { if (t >= start) wakes++; screenOnAt = t }
        SCREEN_NON_INTERACTIVE -> { close(t); if (screenOnAt >= 0) screenPeriod(screenOnAt, t); screenOnAt = -1 }
        KEYGUARD_HIDDEN -> { sawKeyguard = true; if (t >= start) unlocks++ }
      }
    }
    close(end)
    if (screenOnAt >= 0) screenPeriod(screenOnAt, end)

    val continuous = screenOn.maxOfOrNull { it[1] - it[0] } ?: 0L
    // Longest gap with the screen off inside waking hours (up to now).
    val focusEnd = min(wakeEnd, end)
    var longestFocus = 0L
    if (focusEnd > wakeStart && screenOn.isNotEmpty()) {
      var cursor = wakeStart
      for (p in screenOn.sortedBy { it[0] }) {
        val s = max(p[0], wakeStart); val e = min(p[1], focusEnd)
        if (e <= wakeStart || s >= focusEnd) continue
        longestFocus = max(longestFocus, s - cursor)
        cursor = max(cursor, e)
      }
      longestFocus = max(longestFocus, focusEnd - cursor)
    }

    val apps = perApp.entries.filter { it.value >= 30_000L }.sortedByDescending { it.value }.take(60).map {
      mapOf("packageName" to it.key, "label" to label(pm, it.key), "category" to category(pm, it.key), "minutes" to it.value / 60_000.0)
    }
    val peak = hourly.indices.maxByOrNull { hourly[it] } ?: 0
    return mapOf(
      "available" to true,
      "dayStart" to start.toDouble(),
      "totalMinutes" to perApp.values.sum() / 60_000.0,
      "hourly" to hourly.map { it / 60_000.0 },
      "hourlyApps" to hourApps.map { m -> m.entries.filter { it.value >= 60_000L }.sortedByDescending { it.value }.take(3).map {
        mapOf("packageName" to it.key, "label" to label(pm, it.key), "category" to category(pm, it.key), "minutes" to it.value / 60_000.0) } },
      "apps" to apps,
      "pickups" to if (sawKeyguard) unlocks else wakes,
      "continuousMinutes" to continuous / 60_000.0,
      "longestFocusMinutes" to if (screenOn.isEmpty()) null else longestFocus / 60_000.0,
      "peakHour" to if (hourly[peak] > 0) peak else null,
    )
  }

  /**
   * Sleep estimate for the night before day (today - daysAgo): the longest screen-off stretch between 20:00 the evening
   * before and 12:00, then extended across short night check-ins (screen on < 10 min) so a 3 a.m. glance doesn't split it.
   * Returns the last use before sleep, the first use after, and those interruptions. Nothing is stored or uploaded here.
   */
  private fun sleepWindow(daysAgo: Int): Map<String, Any?> {
    if (!usageAccessGranted()) return mapOf("available" to false)
    val cal = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
      add(Calendar.DAY_OF_YEAR, -daysAgo)
    }
    val midnight = cal.timeInMillis
    val winStart = midnight - 4 * HOUR
    val now = System.currentTimeMillis()
    val winEnd = min(midnight + 12 * HOUR, now)
    if (winEnd <= winStart + HOUR) return mapOf("available" to true, "detected" to false)
    val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val events = usm.queryEvents(winStart - 2 * HOUR, winEnd)
    val ev = UsageEvents.Event()
    val on = ArrayList<LongArray>()
    var onAt = -1L
    var sawScreen = false
    while (events.hasNextEvent()) {
      events.getNextEvent(ev)
      val t = ev.timeStamp
      when (ev.eventType) {
        SCREEN_INTERACTIVE -> { sawScreen = true; onAt = t }
        SCREEN_NON_INTERACTIVE -> { sawScreen = true; if (onAt >= 0) on.add(longArrayOf(max(onAt, winStart), min(t, winEnd))); onAt = -1 }
      }
    }
    if (onAt >= 0) on.add(longArrayOf(max(onAt, winStart), winEnd))
    if (!sawScreen) return mapOf("available" to true, "detected" to false, "reason" to "no screen events")
    val periods = on.filter { it[1] > it[0] && it[1] > winStart && it[0] < winEnd }.sortedBy { it[0] }
    // gaps between screen-on periods (and the window edges)
    val gaps = ArrayList<LongArray>()
    var cursor = winStart
    for (pr in periods) { if (pr[0] > cursor) gaps.add(longArrayOf(cursor, pr[0])); cursor = max(cursor, pr[1]) }
    if (winEnd > cursor) gaps.add(longArrayOf(cursor, winEnd))
    if (gaps.isEmpty()) return mapOf("available" to true, "detected" to false)
    val core = gaps.indices.maxByOrNull { gaps[it][1] - gaps[it][0] }!!
    var first = core; var last = core
    val breaks = ArrayList<Map<String, Double>>()
    // merge across short interruptions (screen on < 10 min followed by >= 20 min off)
    while (last + 1 < gaps.size) {
      val wake = gaps[last + 1][0] - gaps[last][1]
      if (wake < 10 * 60_000L && gaps[last + 1][1] - gaps[last + 1][0] >= 20 * 60_000L) {
        breaks.add(mapOf("at" to gaps[last][1].toDouble(), "minutes" to wake / 60_000.0)); last++
      } else break
    }
    while (first - 1 >= 0) {
      val wake = gaps[first][0] - gaps[first - 1][1]
      if (wake < 10 * 60_000L && gaps[first - 1][1] - gaps[first - 1][0] >= 20 * 60_000L) {
        breaks.add(0, mapOf("at" to gaps[first - 1][1].toDouble(), "minutes" to wake / 60_000.0)); first--
      } else break
    }
    val lastUse = gaps[first][0]
    val firstUse = gaps[last][1]
    val coreMin = (gaps[core][1] - gaps[core][0]) / 60_000.0
    val spanMin = (firstUse - lastUse) / 60_000.0
    return mapOf(
      "available" to true, "detected" to (spanMin >= 180.0),
      "lastUse" to lastUse.toDouble(), "firstUse" to firstUse.toDouble(),
      "stillAsleep" to (firstUse >= winEnd && winEnd == now),
      "coreMinutes" to coreMin, "spanMinutes" to spanMin, "interruptions" to breaks,
      "windowStart" to winStart.toDouble(), "windowEnd" to winEnd.toDouble(),
    )
  }

  companion object {
    private const val HOUR = 3_600_000L
    // UsageEvents constants (some are API 28+/29+; on older phones they simply never appear).
    private const val ACTIVITY_RESUMED = 1 // = MOVE_TO_FOREGROUND before API 29
    private const val ACTIVITY_PAUSED = 2
    private const val ACTIVITY_STOPPED = 23
    private const val SCREEN_INTERACTIVE = 15
    private const val SCREEN_NON_INTERACTIVE = 16
    private const val KEYGUARD_HIDDEN = 18

    private val KNOWN = mapOf(
      "com.facebook.katana" to "social", "com.facebook.lite" to "social", "com.instagram.android" to "social",
      "com.zhiliaoapp.musically" to "social", "com.ss.android.ugc.trill" to "social", "com.twitter.android" to "social",
      "com.snapchat.android" to "social", "com.reddit.frontpage" to "social", "com.pinterest" to "social",
      "com.linkedin.android" to "social", "com.discord" to "social", "org.telegram.messenger" to "social",
      "com.whatsapp" to "social", "com.whatsapp.w4b" to "social", "com.facebook.orca" to "social", "com.viber.voip" to "social",
      "com.google.android.youtube" to "entertainment", "com.netflix.mediaclient" to "entertainment", "com.spotify.music" to "entertainment",
      "com.amazon.avod.thirdpartyclient" to "entertainment", "com.disney.disneyplus" to "entertainment",
      "com.duolingo" to "education", "com.google.android.apps.classroom" to "education", "org.khanacademy.android" to "education",
      "com.coursera.app" to "education", "com.udemy.android" to "education",
      "com.google.android.apps.fitness" to "health", "com.samsung.android.app.health" to "health", "com.strava" to "health",
      "com.amazon.mShop.android.shopping" to "shopping", "com.alibaba.aliexpresshd" to "shopping", "com.ubercab.eats" to "shopping",
      "com.einnovation.temu" to "shopping", "com.daraz.android" to "shopping", "com.ebay.mobile" to "shopping",
      "com.google.android.gm" to "productivity", "com.google.android.calendar" to "productivity", "com.google.android.apps.docs" to "productivity",
      "com.microsoft.office.outlook" to "productivity", "com.notion.id" to "productivity", "com.slack" to "productivity",
    )
  }
}
