package expo.modules.sakunashield

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Calendar

/** JS bridge for Sakuna Shield: permissions, screen-time monitor, block rules and focus sessions. */
class SakunaShieldModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SakunaShield")

    Function("getStatus") { status() }
    Function("openAccessibilitySettings") { openSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS) }
    Function("openUsageAccessSettings") { openSettings(Settings.ACTION_USAGE_ACCESS_SETTINGS) }

    Function("getConfig") {
      val config = ShieldStore.config(ctx)
      mapOf("apps" to config.apps.sorted(), "domains" to config.domains.sorted(), "alwaysOn" to config.alwaysOn)
    }

    Function("setConfig") { apps: List<String>, domains: List<String>, alwaysOn: Boolean ->
      if (ShieldStore.strictActive(ctx)) {
        throw CodedException("ERR_SHIELD_STRICT", "Strict mode is on. Block rules can't be changed until the session ends.", null)
      }
      ShieldStore.saveConfig(ctx, apps, domains, alwaysOn)
      status()
    }

    Function("startSession") { minutes: Int, strict: Boolean ->
      if (minutes < 1 || minutes > ShieldStore.MAX_SESSION_MINUTES) {
        throw CodedException("ERR_SHIELD_MINUTES", "Choose between 1 and ${ShieldStore.MAX_SESSION_MINUTES} minutes.", null)
      }
      if (ShieldStore.strictActive(ctx)) {
        throw CodedException("ERR_SHIELD_STRICT", "A strict session is already running.", null)
      }
      ShieldStore.startSession(ctx, minutes, strict)
      status()
    }

    Function("requestExit") {
      ShieldStore.requestExit(ctx)
      status()
    }

    Function("endSession") {
      if (!ShieldStore.endSession(ctx)) {
        throw CodedException("ERR_SHIELD_STRICT", "Strict mode: request an exit and wait for the cooldown first.", null)
      }
      status()
    }

    AsyncFunction("getInstalledApps") { installedApps() }
    AsyncFunction("getUsageToday") { usageToday() }
  }

  private fun status(): Map<String, Any?> = mapOf(
    "accessibility" to accessibilityEnabled(),
    "usageAccess" to usageAccessGranted(),
    "sessionEndsAt" to ShieldStore.sessionEndsAt(ctx).toDouble(),
    "sessionActive" to ShieldStore.sessionActive(ctx),
    "strict" to ShieldStore.strictActive(ctx),
    "blockingActive" to ShieldStore.blockingActive(ctx),
    "exitAvailableAt" to ShieldStore.exitAvailableAt(ctx).toDouble(),
    "blocksToday" to ShieldStore.blocksToday(ctx),
  )

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
      .map { mapOf("packageName" to it.first, "label" to it.second) }
  }

  /** Today's foreground time per launchable app (minutes). Computed on the phone; never uploaded. */
  private fun usageToday(): List<Map<String, Any>> {
    if (!usageAccessGranted()) return emptyList()
    val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val start = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis
    val pm = ctx.packageManager
    return usm.queryAndAggregateUsageStats(start, System.currentTimeMillis()).values
      .filter { it.totalTimeInForeground >= 60_000L && it.packageName != ctx.packageName }
      .filter { pm.getLaunchIntentForPackage(it.packageName) != null }
      .sortedByDescending { it.totalTimeInForeground }
      .take(40)
      .map { mapOf("packageName" to it.packageName, "label" to label(pm, it.packageName), "minutes" to (it.totalTimeInForeground / 60_000L).toInt()) }
  }
}
