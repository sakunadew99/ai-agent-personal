package expo.modules.sakunashield

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Blocklists, quick-block sessions and Strict Mode, shared by the JS module and the accessibility service.
 * Privacy: stores the rules, app marks and a per-day block COUNT only. No usage history, URLs or screen content.
 */
object ShieldStore {
  private const val PREFS = "sakuna_shield"
  private const val LISTS_KEY = "lists_v2"
  const val EXIT_COOLDOWN_MS = 15 * 60 * 1000L
  const val MAX_SESSION_MINUTES = 12 * 60
  const val MAX_STRICT_MINUTES = 24 * 60

  /**
   * days: 1 = Monday … 7 = Sunday. Minutes from midnight. start > end runs overnight; start == end is all day.
   * from / until: optional calendar dates ("yyyy-MM-dd", inclusive), e.g. block only during an exam month.
   */
  data class Schedule(val days: Set<Int>, val start: Int, val end: Int, val from: String? = null, val until: String? = null) {
    fun activeAt(day: Int, minute: Int): Boolean {
      val prev = if (day == 1) 7 else day - 1
      return when {
        start == end -> day in days
        start < end -> day in days && minute >= start && minute < end
        else -> (day in days && minute >= start) || (prev in days && minute < end)
      }
    }

    fun activeAt(millis: Long): Boolean {
      val c = Calendar.getInstance().apply { timeInMillis = millis }
      val today = String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
      // An overnight block that started on the last date still runs into the next morning.
      val yesterday = Calendar.getInstance().apply { timeInMillis = millis; add(Calendar.DAY_OF_MONTH, -1) }
        .let { y -> String.format(Locale.US, "%04d-%02d-%02d", y.get(Calendar.YEAR), y.get(Calendar.MONTH) + 1, y.get(Calendar.DAY_OF_MONTH)) }
      val minuteNow = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
      val dateFor = if (start > end && minuteNow < end) yesterday else today
      if (from != null && dateFor < from) return false
      if (until != null && dateFor > until) return false
      val day = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7 + 1 // Calendar: Sunday=1 -> 7, Monday=2 -> 1
      return activeAt(day, c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE))
    }
  }

  /** mode: "manual" = only during a quick block, "always", or "schedule". */
  data class BlockList(
    val id: String,
    val name: String,
    val mode: String,
    val schedule: Schedule?,
    val apps: Set<String>,
    val domains: Set<String>,
    val keywords: Set<String>,
    val newApps: Boolean,
    val newAppsSince: Long,
    val adult: Boolean,
    val purchases: Boolean,
    val unsupportedBrowsers: Boolean,
    val shorts: Boolean = false,     // YouTube Shorts and Instagram Reels, while the rest of those apps keeps working
  ) {
    val hasWebRules get() = domains.isNotEmpty() || keywords.isNotEmpty() || adult
  }

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // The accessibility service reads the lists on every event, so keep them in memory (same process as the module).
  @Volatile private var cache: List<BlockList>? = null

  // ---------- JSON ----------

  private fun JSONArray?.strings(): Set<String> =
    if (this == null) emptySet() else (0 until length()).map { optString(it) }.filter { it.isNotBlank() }.toSet()

  private fun parseList(o: JSONObject): BlockList {
    val s = o.optJSONObject("schedule")
    val days = s?.optJSONArray("days")?.let { a -> (0 until a.length()).map { a.optInt(it) }.filter { it in 1..7 }.toSet() } ?: emptySet()
    return BlockList(
      id = o.optString("id").ifBlank { UUID.randomUUID().toString() },
      name = o.optString("name").trim().ifBlank { "Blocklist" }.take(40),
      mode = o.optString("mode").takeIf { it in setOf("manual", "always", "schedule") } ?: "manual",
      schedule = s?.let {
        val dateRe = Regex("\\d{4}-\\d{2}-\\d{2}")
        Schedule(days, it.optInt("start").coerceIn(0, 1439), it.optInt("end").coerceIn(0, 1439),
          it.optString("from").takeIf { d -> dateRe.matches(d) }, it.optString("until").takeIf { d -> dateRe.matches(d) })
      },
      apps = o.optJSONArray("apps").strings(),
      domains = o.optJSONArray("domains").strings().map { normalizeDomain(it) }.filter { it.contains('.') }.toSet(),
      keywords = o.optJSONArray("keywords").strings().map { it.trim().lowercase(Locale.ROOT) }.filter { it.length >= 2 }.toSet(),
      newApps = o.optBoolean("newApps"),
      newAppsSince = o.optLong("newAppsSince", 0L),
      adult = o.optBoolean("adult"),
      purchases = o.optBoolean("purchases"),
      unsupportedBrowsers = o.optBoolean("unsupportedBrowsers"),
      shorts = o.optBoolean("shorts"),
    )
  }

  fun toJson(l: BlockList): JSONObject = JSONObject().apply {
    put("id", l.id); put("name", l.name); put("mode", l.mode)
    put("schedule", l.schedule?.let { s ->
      JSONObject().put("days", JSONArray(s.days.sorted())).put("start", s.start).put("end", s.end)
        .put("from", s.from ?: JSONObject.NULL).put("until", s.until ?: JSONObject.NULL)
    } ?: JSONObject.NULL)
    put("apps", JSONArray(l.apps.sorted())); put("domains", JSONArray(l.domains.sorted())); put("keywords", JSONArray(l.keywords.sorted()))
    put("newApps", l.newApps); put("newAppsSince", l.newAppsSince); put("adult", l.adult)
    put("purchases", l.purchases); put("unsupportedBrowsers", l.unsupportedBrowsers); put("shorts", l.shorts)
  }

  fun listsJson(ctx: Context): String = JSONArray(lists(ctx).map { toJson(it) }).toString()

  // ---------- Lists ----------

  fun lists(ctx: Context): List<BlockList> {
    cache?.let { return it }
    migrate(ctx)
    val raw = prefs(ctx).getString(LISTS_KEY, "[]") ?: "[]"
    val parsed = try {
      val a = JSONArray(raw); (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(::parseList) }
    } catch (_: Exception) { emptyList() }
    cache = parsed
    return parsed
  }

  private fun writeLists(ctx: Context, lists: List<BlockList>) {
    prefs(ctx).edit().putString(LISTS_KEY, JSONArray(lists.map { toJson(it) }).toString()).apply()
    cache = lists
  }

  /** One-time move from the single-list version (apps/domains/alwaysOn + session strict flag). */
  private fun migrate(ctx: Context) {
    val p = prefs(ctx)
    if (p.contains(LISTS_KEY)) return
    val apps = p.getStringSet("apps", emptySet()) ?: emptySet()
    val domains = p.getStringSet("domains", emptySet()) ?: emptySet()
    val first = BlockList(
      UUID.randomUUID().toString(), "My blocklist", if (p.getBoolean("alwaysOn", false)) "always" else "manual", null,
      apps.toSet(), domains.toSet(), emptySet(), false, 0L, false, false, false,
    )
    val e = p.edit().putString(LISTS_KEY, JSONArray(listOf(toJson(first))).toString())
    if (p.getBoolean("sessionStrict", false) && p.getLong("sessionEndsAt", 0L) > System.currentTimeMillis()) {
      e.putString("strictMethod", "timer").putLong("strictEndsAt", p.getLong("sessionEndsAt", 0L))
    }
    e.remove("apps").remove("domains").remove("alwaysOn").remove("sessionStrict").apply()
  }

  /** Saves (creates or replaces) a list. Returns an error message, or null when saved. */
  fun saveList(ctx: Context, json: String): String? {
    val incoming = try { parseList(JSONObject(json)) } catch (_: Exception) { return "That blocklist couldn't be read." }
    if (incoming.mode == "schedule" && (incoming.schedule == null || incoming.schedule.days.isEmpty())) {
      return "Pick at least one day for the schedule."
    }
    val current = lists(ctx)
    val old = current.firstOrNull { it.id == incoming.id }
    var next = incoming
    // "Block newly installed apps" counts from the moment it is switched on.
    if (next.newApps && (old == null || !old.newApps)) next = next.copy(newAppsSince = System.currentTimeMillis())
    if (!next.newApps) next = next.copy(newAppsSince = 0L)
    if (strictActive(ctx)) {
      if (old == null) return null.also { writeLists(ctx, current + next) } // new lists are fine
      weakens(old, next)?.let { return "Strict Mode is on: $it" }
    }
    writeLists(ctx, if (old == null) current + next else current.map { if (it.id == next.id) next else it })
    return null
  }

  /** Strict Mode allows only additions: nothing removed, no option switched off, no schedule shortened. */
  private fun weakens(old: BlockList, new: BlockList): String? = when {
    !new.apps.containsAll(old.apps) -> "apps can be added but not removed."
    !new.domains.containsAll(old.domains) -> "websites can be added but not removed."
    !new.keywords.containsAll(old.keywords) -> "keywords can be added but not removed."
    (old.newApps && !new.newApps) || (old.adult && !new.adult) || (old.purchases && !new.purchases) ||
      (old.unsupportedBrowsers && !new.unsupportedBrowsers) || (old.shorts && !new.shorts) -> "options can be switched on but not off."
    old.mode == "always" && new.mode != "always" -> "an always-on list must stay on."
    old.mode == "schedule" && new.mode == "manual" -> "a scheduled list can't be switched off."
    old.mode == "schedule" && new.mode == "schedule" && old.schedule != new.schedule -> "the schedule can't be changed (you can switch the list to Always)."
    else -> null
  }

  fun deleteList(ctx: Context, id: String): String? {
    if (strictActive(ctx)) return "Strict Mode is on: blocklists can't be deleted."
    writeLists(ctx, lists(ctx).filter { it.id != id })
    return null
  }

  /** Used by "Block newly installed apps". Each app is added only once, so removing it later sticks. */
  fun addApp(ctx: Context, listId: String, pkg: String) {
    writeLists(ctx, lists(ctx).map { if (it.id == listId) it.copy(apps = it.apps + pkg) else it })
    val p = prefs(ctx)
    p.edit().putStringSet("autoAdded", (p.getStringSet("autoAdded", emptySet()) ?: emptySet()) + pkg).apply()
  }

  fun wasAutoAdded(ctx: Context, pkg: String): Boolean = prefs(ctx).getStringSet("autoAdded", emptySet())?.contains(pkg) == true

  // ---------- What is blocking right now ----------

  fun sessionEndsAt(ctx: Context): Long = prefs(ctx).getLong("sessionEndsAt", 0L)
  fun sessionActive(ctx: Context, now: Long = System.currentTimeMillis()) = sessionEndsAt(ctx) > now
  fun sessionListIds(ctx: Context): Set<String> = prefs(ctx).getStringSet("sessionLists", emptySet())?.toSet() ?: emptySet()

  fun activeLists(ctx: Context, now: Long = System.currentTimeMillis()): List<BlockList> {
    val session = sessionActive(ctx, now)
    val ids = if (session) sessionListIds(ctx) else emptySet()
    return lists(ctx).filter { l ->
      l.mode == "always" ||
        (l.mode == "schedule" && l.schedule?.activeAt(now) == true) ||
        (session && (ids.isEmpty() || l.id in ids))
    }
  }

  fun blockingActive(ctx: Context) = activeLists(ctx).isNotEmpty()

  fun startSession(ctx: Context, minutes: Int, listIds: Collection<String>) {
    prefs(ctx).edit()
      .putLong("sessionEndsAt", System.currentTimeMillis() + minutes * 60_000L)
      .putStringSet("sessionLists", listIds.toSet())
      .apply()
  }

  fun endSession(ctx: Context): String? {
    if (strictActive(ctx)) return "Strict Mode is on. End Strict Mode first."
    prefs(ctx).edit().putLong("sessionEndsAt", 0L).putStringSet("sessionLists", emptySet()).apply()
    return null
  }

  // ---------- Strict Mode ----------

  fun strictMethod(ctx: Context): String = prefs(ctx).getString("strictMethod", "") ?: ""
  fun strictEndsAt(ctx: Context): Long = prefs(ctx).getLong("strictEndsAt", 0L)
  private fun exitRequestedAt(ctx: Context): Long = prefs(ctx).getLong("exitRequestedAt", 0L)

  fun strictActive(ctx: Context, now: Long = System.currentTimeMillis()): Boolean = when (strictMethod(ctx)) {
    "timer" -> strictEndsAt(ctx) > now
    "schedule", "charger" -> true
    else -> false
  }

  fun isCharging(ctx: Context): Boolean {
    val battery = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return false
    return battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
  }

  private fun anyScheduleActive(ctx: Context, now: Long = System.currentTimeMillis()) =
    lists(ctx).any { it.mode == "schedule" && it.schedule?.activeAt(now) == true }

  /** True if the schedules leave at least some time free each week (otherwise schedule-strict could never end). */
  private fun schedulesLeaveGaps(ctx: Context): Boolean {
    val scheduled = lists(ctx).filter { it.mode == "schedule" && it.schedule != null }
    for (day in 1..7) for (minute in 0 until 1440 step 15) {
      if (scheduled.none { it.schedule!!.activeAt(day, minute) }) return true
    }
    return false
  }

  fun startStrict(ctx: Context, method: String, minutes: Int): String? {
    if (strictActive(ctx)) return "Strict Mode is already on."
    when (method) {
      "timer" -> if (minutes < 1 || minutes > MAX_STRICT_MINUTES) return "Choose between 1 minute and 24 hours."
      "schedule" -> {
        if (lists(ctx).none { it.mode == "schedule" }) return "Give at least one blocklist a schedule first."
        if (!schedulesLeaveGaps(ctx)) return "Your schedules cover the whole week, so Strict Mode could never end. Leave some free time."
      }
      "charger" -> Unit
      else -> return "Choose an unlock method."
    }
    prefs(ctx).edit()
      .putString("strictMethod", method)
      .putLong("strictEndsAt", if (method == "timer") System.currentTimeMillis() + minutes * 60_000L else 0L)
      .putLong("exitRequestedAt", 0L)
      .apply()
    return null
  }

  /** Timer only: starts the 15-minute early-exit wait (only the first request counts). */
  fun requestStrictExit(ctx: Context) {
    if (strictMethod(ctx) == "timer" && strictActive(ctx) && exitRequestedAt(ctx) == 0L) {
      prefs(ctx).edit().putLong("exitRequestedAt", System.currentTimeMillis()).apply()
    }
  }

  /** Timer: 0 = no wait requested yet; otherwise when early exit becomes possible. */
  fun exitAvailableAt(ctx: Context): Long = exitRequestedAt(ctx).let { if (it == 0L) 0L else it + EXIT_COOLDOWN_MS }

  /** null when Strict Mode may be switched off now, otherwise why not. */
  fun strictBlockedReason(ctx: Context, now: Long = System.currentTimeMillis()): String? {
    if (!strictActive(ctx, now)) return null
    return when (strictMethod(ctx)) {
      "timer" -> {
        val at = exitAvailableAt(ctx)
        if (at in 1..now) null else if (at == 0L) "The timer is still running. You can ask for an early exit (15-minute wait)." else "Early exit opens after the 15-minute wait."
      }
      "schedule" -> if (anyScheduleActive(ctx, now)) "A schedule is running. You can turn Strict Mode off when no schedule is active." else null
      "charger" -> if (isCharging(ctx)) null else "Put your phone on a charger to turn Strict Mode off."
      else -> null
    }
  }

  fun endStrict(ctx: Context): String? {
    strictBlockedReason(ctx)?.let { return it }
    prefs(ctx).edit().putString("strictMethod", "").putLong("strictEndsAt", 0L).putLong("exitRequestedAt", 0L).apply()
    return null
  }

  // ---------- Small helpers ----------

  /** "https://www.YouTube.com/watch?v=1" -> "youtube.com" */
  fun normalizeDomain(raw: String): String = raw.trim().lowercase(Locale.ROOT)
    .removePrefix("https://").removePrefix("http://").removePrefix("www.")
    .substringBefore('/').substringBefore('?').substringBefore('#').substringBefore(':')
    .trim()

  fun domainMatches(host: String, blocked: Set<String>): Boolean =
    host.isNotEmpty() && blocked.any { host == it || host.endsWith(".$it") }

  /** Distracting / neutral / productive marks for Insights, set by the user. */
  fun appMarks(ctx: Context): Map<String, String> {
    val raw = prefs(ctx).getString("appMarks", "{}") ?: "{}"
    return try { JSONObject(raw).let { o -> o.keys().asSequence().associateWith { o.optString(it) } } } catch (_: Exception) { emptyMap() }
  }

  fun setAppMark(ctx: Context, pkg: String, mark: String) {
    val marks = appMarks(ctx).toMutableMap()
    if (mark in setOf("distracting", "neutral", "productive")) marks[pkg] = mark else marks.remove(pkg)
    prefs(ctx).edit().putString("appMarks", JSONObject(marks as Map<*, *>).toString()).apply()
  }

  private fun dayKey() = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

  fun countBlock(ctx: Context) {
    val key = "blocks_" + dayKey()
    val p = prefs(ctx)
    p.edit().putInt(key, p.getInt(key, 0) + 1).apply()
  }

  fun blocksToday(ctx: Context): Int = prefs(ctx).getInt("blocks_" + dayKey(), 0)
}
