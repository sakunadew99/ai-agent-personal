package expo.modules.sakunashield

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Block rules and session state, shared by the JS module and the accessibility service.
 * Privacy: stores rules and a per-day block COUNT only. No app-usage history, URLs or screen content.
 */
object ShieldStore {
  private const val PREFS = "sakuna_shield"
  const val EXIT_COOLDOWN_MS = 15 * 60 * 1000L
  const val MAX_SESSION_MINUTES = 12 * 60

  data class Config(val apps: Set<String>, val domains: Set<String>, val alwaysOn: Boolean)

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun config(ctx: Context): Config {
    val p = prefs(ctx)
    return Config(
      p.getStringSet("apps", emptySet())?.toSet() ?: emptySet(),
      p.getStringSet("domains", emptySet())?.toSet() ?: emptySet(),
      p.getBoolean("alwaysOn", false),
    )
  }

  fun saveConfig(ctx: Context, apps: Collection<String>, domains: Collection<String>, alwaysOn: Boolean) {
    val cleanDomains = domains.map { normalizeDomain(it) }.filter { it.contains('.') }.toSet()
    prefs(ctx).edit()
      .putStringSet("apps", apps.filter { it.isNotBlank() }.toSet())
      .putStringSet("domains", cleanDomains)
      .putBoolean("alwaysOn", alwaysOn)
      .apply()
  }

  /** "https://www.YouTube.com/watch?v=1" -> "youtube.com" */
  fun normalizeDomain(raw: String): String = raw.trim().lowercase(Locale.ROOT)
    .removePrefix("https://").removePrefix("http://").removePrefix("www.")
    .substringBefore('/').substringBefore('?').substringBefore('#').substringBefore(':')
    .trim()

  fun domainMatches(host: String, blocked: Set<String>): Boolean =
    host.isNotEmpty() && blocked.any { host == it || host.endsWith(".$it") }

  fun sessionEndsAt(ctx: Context): Long = prefs(ctx).getLong("sessionEndsAt", 0L)
  private fun sessionStrict(ctx: Context): Boolean = prefs(ctx).getBoolean("sessionStrict", false)
  private fun exitRequestedAt(ctx: Context): Long = prefs(ctx).getLong("exitRequestedAt", 0L)

  fun sessionActive(ctx: Context, now: Long = System.currentTimeMillis()) = sessionEndsAt(ctx) > now
  fun strictActive(ctx: Context, now: Long = System.currentTimeMillis()) = sessionActive(ctx, now) && sessionStrict(ctx)
  fun blockingActive(ctx: Context) = sessionActive(ctx) || config(ctx).alwaysOn

  fun startSession(ctx: Context, minutes: Int, strict: Boolean) {
    prefs(ctx).edit()
      .putLong("sessionEndsAt", System.currentTimeMillis() + minutes * 60_000L)
      .putBoolean("sessionStrict", strict)
      .putLong("exitRequestedAt", 0L)
      .apply()
  }

  /** Strict mode: the early-exit cooldown starts now (only the first request counts). */
  fun requestExit(ctx: Context) {
    if (strictActive(ctx) && exitRequestedAt(ctx) == 0L) {
      prefs(ctx).edit().putLong("exitRequestedAt", System.currentTimeMillis()).apply()
    }
  }

  /** 0 = can end now; -1 = strict and no exit requested yet; otherwise the time (ms) it becomes possible. */
  fun exitAvailableAt(ctx: Context): Long {
    if (!strictActive(ctx)) return 0L
    val requested = exitRequestedAt(ctx)
    return if (requested == 0L) -1L else requested + EXIT_COOLDOWN_MS
  }

  /** Returns false while strict mode forbids ending the session. */
  fun endSession(ctx: Context): Boolean {
    val available = exitAvailableAt(ctx)
    if (available == -1L || (available > 0L && System.currentTimeMillis() < available)) return false
    prefs(ctx).edit()
      .putLong("sessionEndsAt", 0L)
      .putBoolean("sessionStrict", false)
      .putLong("exitRequestedAt", 0L)
      .apply()
    return true
  }

  private fun dayKey() = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

  fun countBlock(ctx: Context) {
    val key = "blocks_" + dayKey()
    val p = prefs(ctx)
    p.edit().putInt(key, p.getInt(key, 0) + 1).apply()
  }

  fun blocksToday(ctx: Context): Int = prefs(ctx).getInt("blocks_" + dayKey(), 0)
}
