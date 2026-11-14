package expo.modules.sakunashield

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.text.DateFormat
import java.util.Date

/** Full-screen "Stay focused" screen shown when a blocked app or website is opened. */
class BlockActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val reason = intent.getStringExtra(EXTRA_REASON) ?: "This is blocked right now."
    val density = resources.displayMetrics.density
    fun dp(value: Int) = (value * density).toInt()

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#0D1110"))
      setPadding(dp(32), dp(48), dp(32), dp(48))
    }

    val mark = TextView(this).apply {
      text = "S"
      textSize = 34f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setTextColor(Color.parseColor("#082316"))
      background = GradientDrawable().apply { cornerRadius = dp(24).toFloat(); setColor(Color.parseColor("#39D98A")) }
      layoutParams = LinearLayout.LayoutParams(dp(80), dp(80)).apply { bottomMargin = dp(28) }
    }

    val title = TextView(this).apply {
      text = "Stay focused"
      textSize = 28f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setTextColor(Color.parseColor("#EDF4EF"))
    }

    val message = TextView(this).apply {
      text = reason
      textSize = 16f
      gravity = Gravity.CENTER
      setTextColor(Color.parseColor("#AAB8AF"))
      setPadding(0, dp(12), 0, dp(8))
    }

    val endsAt = ShieldStore.sessionEndsAt(this)
    val until = TextView(this).apply {
      text = if (endsAt > System.currentTimeMillis())
        "Focus session until " + DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(endsAt))
      else "Blocked by your Sakuna rules"
      textSize = 14f
      gravity = Gravity.CENTER
      setTextColor(Color.parseColor("#39D98A"))
      setPadding(0, 0, 0, dp(32))
    }

    val home = Button(this).apply {
      text = "Back to home screen"
      isAllCaps = false
      textSize = 16f
      setTextColor(Color.parseColor("#082316"))
      background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(Color.parseColor("#39D98A")) }
      setPadding(dp(24), dp(14), dp(24), dp(14))
      setOnClickListener { goHome() }
    }

    root.addView(mark)
    root.addView(title)
    root.addView(message)
    root.addView(until)
    root.addView(home)
    setContentView(root)
  }

  @Deprecated("Back always leaves to the home screen")
  override fun onBackPressed() {
    goHome()
  }

  private fun goHome() {
    startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    finish()
  }

  companion object {
    const val EXTRA_REASON = "reason"
  }
}
