/**
 * App-wide text size and Sinhala labels, applied at the single point where React Native draws <Text> and <TextInput>.
 * - Text size: every font size (and line height) is multiplied by the chosen scale (0.9 / 1 / 1.15 / 1.3), on top of the
 *   phone's own font-size setting.
 * - Sinhala: labels that exactly match an entry below are shown in Sinhala (tabs, hubs, screen titles, buttons, settings,
 *   Today, notification centre). Everything else stays English. Your own data (tasks, notes…) is never changed.
 * If the hook can't be installed on some engine, the app simply stays at normal size in English.
 */
import { StyleSheet, Text, TextInput } from "react-native";
import { LANGS, TEXT_SIZES, subscribe, theme, type Lang } from "./theme";

export const SI: Record<string, string> = {
  // tabs, header, hubs
  "Today": "අද", "Plan": "සැලැස්ම", "Add": "එක් කරන්න", "Focus": "අවධානය", "Hubs": "සියල්ල", "Your day, in focus.": "ඔබේ දිනය, අවධානයෙන්.",
  "Today & plan": "අද සහ සැලැස්ම", "Body": "ශරීරය", "Grow": "වර්ධනය", "Discover": "සොයාගන්න", "Mind": "මනස", "Money & career": "මුදල් සහ වෘත්තිය",
  "Sakuna AI": "සකුණ AI", "Settings": "සැකසුම්",
  "Your day, plan, schedule and reviews": "ඔබේ දිනය, සැලැස්ම, කාලසටහන සහ සමාලෝචන",
  "Health, gym, food, sleep, water and care": "සෞඛ්‍යය, ජිම්, ආහාර, නින්ද, ජලය සහ රැකවරණය",
  "Learning, reading, languages and skills": "ඉගෙනීම, කියවීම, භාෂා සහ කුසලතා",
  "Learning feed, reels, videos and news": "ඉගෙනුම් පෝෂණය, රීල්ස්, වීඩියෝ සහ පුවත්",
  "Mindset, journal, notes, self-control, dreams": "මානසිකත්වය, දිනපොත, සටහන්, ස්වයං පාලනය, සිහින",
  "Money, investing, $1M plan, jobs, freelancing": "මුදල්, ආයෝජන, $1M සැලැස්ම, රැකියා, නිදහස් සේවය",
  "Assistant, AI team, approvals and memory": "සහායක, AI කණ්ඩායම, අනුමැතීන් සහ මතකය",
  "Profile, notifications, appearance, privacy": "පැතිකඩ, දැනුම්දීම්, පෙනුම, පෞද්ගලිකත්වය",
  "‹ All hubs": "‹ සියලු කොටස්", "📌 Pinned": "📌 සවි කළ", "🕘 Recently used": "🕘 මෑතකදී භාවිත කළ",
  "Search apps and everything you saved…": "යෙදුම් සහ ඔබ සුරැකි සියල්ල සොයන්න…", "Search Sakuna…": "සකුණ තුළ සොයන්න…",
  // screen titles
  "Life board": "ජීවිත පුවරුව", "Day tracker": "දින වාර්තාව", "My schedule": "මගේ කාලසටහන", "Review": "සමාලෝචනය", "Weekly review": "සතිපතා සමාලෝචනය",
  "My life": "මගේ ජීවිතය", "Life balance": "ජීවිත සමතුලිතතාව", "Ask Sakuna": "සකුණගෙන් අහන්න", "Health & Mi Band": "සෞඛ්‍යය සහ Mi Band", "Gym": "ජිම්",
  "Fitness guide": "යෝග්‍යතා මඟපෙන්වීම", "Body measurements": "ශරීර මිනුම්", "Sleep": "නින්ද", "Water": "ජලය", "Martial arts & swimming": "සටන් කලා සහ පිහිනීම",
  "Skin & glow": "සම සහ දීප්තිය", "Pelvic floor": "ශ්‍රෝණි මාංශ පේශි", "Medicines": "ඖෂධ", "Learning": "ඉගෙනීම", "Reading": "කියවීම",
  "Learn anything": "ඕනෑම දෙයක් ඉගෙන ගන්න", "Skills & trainers": "කුසලතා සහ පුහුණු", "Speaking coach": "කතා කිරීමේ පුහුණුව", "English check": "ඉංග්‍රීසි පරීක්ෂාව",
  "Role-play coach": "චරිත රඟපෑම් පුහුණුව", "Study abroad": "විදේශ අධ්‍යාපනය", "Exam coach": "විභාග පුහුණුව", "Learning hub": "ඉගෙනුම් කේන්ද්‍රය",
  "Learning reels": "ඉගෙනුම් රීල්ස්", "Learning feed": "ඉගෙනුම් පෝෂණය", "My videos": "මගේ වීඩියෝ", "Feed": "පුවත්", "News digest": "පුවත් සාරාංශය",
  "Mindset studio": "මානසිකත්ව කුටිය", "Journal": "දිනපොත", "Notes": "සටහන්", "Self-control": "ස්වයං පාලනය", "Dreams & goals": "සිහින සහ ඉලක්ක",
  "Rewards game": "ත්‍යාග ක්‍රීඩාව", "Rewards": "ත්‍යාග", "Money": "මුදල්", "Money hub": "මුදල් කේන්ද්‍රය", "$1M journey & ideas": "$1M ගමන සහ අදහස්",
  "Invest (CSE)": "ආයෝජන (CSE)", "Jobs": "රැකියා", "Job tracker": "රැකියා ලුහුබැඳීම", "Freelancing kit": "නිදහස් සේවා කට්ටලය", "Content studio": "අන්තර්ගත කුටිය",
  "Travel guide": "සංචාරක මඟපෙන්වීම", "Assistant": "සහායක", "AI team": "AI කණ්ඩායම", "Approvals": "අනුමැතීන්", "Memory": "මතකය",
  "AI & privacy": "AI සහ පෞද්ගලිකත්වය", "AI usage & privacy": "AI භාවිතය සහ පෞද්ගලිකත්වය", "Settings & profile": "සැකසුම් සහ පැතිකඩ", "Appearance": "පෙනුම",
  // plan views
  "☀️ Day": "☀️ දිනය", "🗓 Week": "🗓 සතිය", "▦ Tasks": "▦ කාර්ය", "🗂 Life": "🗂 ජීවිතය", "📅 Month": "📅 මාසය",
  // common buttons
  "Save": "සුරකින්න", "Cancel": "අවලංගු කරන්න", "Next": "ඊළඟ", "Back": "ආපසු", "Close": "වසන්න", "Done": "අවසන්", "✓ Done": "✓ අවසන්",
  "Sign out": "ඉවත් වන්න", "Load more": "තවත් පෙන්වන්න", "Remove": "ඉවත් කරන්න", "Delete": "මකන්න", "Edit": "සංස්කරණය", "Skip setup": "සැකසීම මඟ හරින්න",
  "Let's go 🚀": "යමු 🚀", "✏️ Customize": "✏️ සකසන්න", "Loading…": "පූරණය වෙමින්…", "Hide": "සඟවන්න",
  // Today
  "Good morning 👋": "සුබ උදෑසනක් 👋", "Good afternoon 👋": "සුබ දහවලක් 👋", "Good evening 👋": "සුබ සන්ධ්‍යාවක් 👋", "productive": "ඵලදායී", "time waste": "කාලය නාස්ති",
  "HABITS TODAY": "අද පුරුදු", "🎯 MOST IMPORTANT NOW": "🎯 දැන් වැදගත්ම දේ", "📅 THIS WEEK": "📅 මෙම සතිය", "🔗 HABIT STACKING IDEAS": "🔗 පුරුදු සම්බන්ධ කිරීමේ අදහස්",
  "No open tasks": "විවෘත කාර්ය නැත", "No sleep data yet": "තවම නින්දේ දත්ත නැත", "Board →": "පුවරුව →", "ARRANGE YOUR TODAY": "ඔබේ අද සකසන්න",
  "🌅 Good morning": "🌅 සුබ උදෑසනක්", "🌙 Night review": "🌙 රාත්‍රී සමාලෝචනය", "🙏 Write gratitude": "🙏 කෘතඥතාව ලියන්න",
  "🧰 More for today: rituals, coach, compass": "🧰 අදට තවත්: චාරිත්‍ර, පුහුණුකරු, මාලිමාව", "📅 YOUR WEEK": "📅 ඔබේ සතිය",
  "TODAY'S AFFIRMATION": "අද දවසේ ධනාත්මක ප්‍රකාශය",
  // settings
  "Profile": "පැතිකඩ", "My day": "මගේ දිනය", "Notification centre": "දැනුම්දීම් මධ්‍යස්ථානය", "Phone access": "දුරකථන ප්‍රවේශය",
  "Privacy, AI & security": "පෞද්ගලිකත්වය, AI සහ ආරක්ෂාව", "Your data": "ඔබේ දත්ත", "Help & about": "උදව් සහ විස්තර", "Name": "නම", "Location": "ස්ථානය",
  "Timezone": "වේලා කලාපය", "Currency": "මුදල් ඒකකය", "Height (cm)": "උස (cm)", "About me": "මා ගැන", "Wake up": "අවදි වීම", "Work starts": "වැඩ ආරම්භය",
  "Work ends": "වැඩ අවසානය", "Gym time": "ජිම් වේලාව", "Save profile": "පැතිකඩ සුරකින්න", "Save times": "වේලාවන් සුරකින්න",
  "Save & apply on this phone": "සුරැකී මෙම දුරකථනයේ යොදන්න", "Every reminder in one place": "සියලු මතක් කිරීම් එකම තැනක",
  "Name, place, timezone, currency, body": "නම, ස්ථානය, වේලා කලාපය, මුදල් ඒකකය, ශරීරය", "Wake, sleep, office and gym times": "අවදිවීම, නින්ද, කාර්යාල සහ ජිම් වේලාවන්",
  "What Sakuna is allowed to use": "සකුණට භාවිත කිරීමට අවසර ඇති දේ", "AI sharing, approvals, app lock": "AI බෙදාගැනීම, අනුමැතීන්, යෙදුම් අගුල",
  "Export everything": "සියල්ල අපනයනය කරන්න", "How things work": "දේවල් ක්‍රියා කරන ආකාරය", "⬇ Export my data": "⬇ මගේ දත්ත අපනයනය කරන්න",
  "↻ Check again": "↻ නැවත පරීක්ෂා කරන්න", "🔒 App lock (fingerprint / PIN)": "🔒 යෙදුම් අගුල (ඇඟිලි සලකුණ / PIN)",
  "⏱ Hourly check-ins (what did you do?)": "⏱ පැයෙන් පැයට පරීක්ෂාව (ඔබ කළේ කුමක්ද?)", "💧 Water reminders every 2 hours": "💧 පැය 2කට වරක් ජලය මතක් කිරීම",
  "✅ Task reminders": "✅ කාර්ය මතක් කිරීම්", "🔁 Habit reminders": "🔁 පුරුදු මතක් කිරීම්", "💊 Medicine reminders": "💊 ඖෂධ මතක් කිරීම්",
  "🛡 Approvals waiting (approve / reject from the notification)": "🛡 අනුමැතීන් (දැනුම්දීමෙන්ම අනුමත / ප්‍රතික්ෂේප කරන්න)",
  "🌅 Morning brief": "🌅 උදෑසන සාරාංශය", "✨ Affirmation of the day": "✨ දවසේ ධනාත්මක ප්‍රකාශය",
  // appearance
  "MODE": "ප්‍රකාරය", "ACCENT COLOUR": "ප්‍රධාන වර්ණය", "PREVIEW": "පෙරදසුන", "TEXT SIZE": "අකුරු ප්‍රමාණය", "LANGUAGE": "භාෂාව",
  "📱 System": "📱 දුරකථනය අනුව", "🌙 Dark": "🌙 අඳුරු", "☀️ Light": "☀️ ආලෝක", "⚫ AMOLED black": "⚫ AMOLED කළු",
  "Small": "කුඩා", "Normal": "සාමාන්‍ය", "Large": "විශාල", "Extra large": "ඉතා විශාල",
  // water / sleep / mindset basics
  // today task list, goals, events, inbox, pop-ups
  "✅ Today's tasks": "✅ අද කාර්ය", "🎁 Daily goals": "🎁 දෛනික ඉලක්ක", "📅 NEXT UP": "📅 ඊළඟට", "Connect Google Calendar": "Google Calendar සම්බන්ධ කරන්න",
  "Add a task for today…": "අදට කාර්යයක් එක් කරන්න…", "Later": "පසුව", "Water goal": "ජල ඉලක්කය", "3 tasks done": "කාර්ය 3ක් අවසන්", "Habits": "පුරුදු",
  "Affirmations": "ධනාත්මක ප්‍රකාශ", "Hours logged": "පැය සටහන්", "No more events today.": "අද තවත් සිදුවීම් නැත.", "Inbox zero. 🎉": "එන ලිපි හිස්. 🎉",
  "🎉 Everything for today is done!": "🎉 අද සියල්ල අවසන්!", "Read-only: Sakuna never sends or deletes email.": "කියවීමට පමණි: සකුණ කිසිවිට ඊමේල් යවන්නේ හෝ මකන්නේ නැත.",
  "🏆 Bonus claimed today. Amazing!": "🏆 අද ත්‍යාගය ලබා ගත්තා. විශිෂ්ටයි!",
  // connections, help
  "Connections": "සම්බන්ධතා", "Google Calendar and Gmail": "Google Calendar සහ Gmail", "Connect": "සම්බන්ධ කරන්න", "Check": "පරීක්ෂා කරන්න",
  "Disconnect": "විසන්ධි කරන්න", "Gmail (read-only)": "Gmail (කියවීමට පමණි)", "📋 Send a problem report": "📋 ගැටලු වාර්තාවක් යවන්න",
  "Run the setup guide again": "සැකසුම් මඟපෙන්වීම නැවත ධාවනය කරන්න", "🗓 Sunday weekly report": "🗓 ඉරිදා සතිපතා වාර්තාව",
  "💾 Sunday backup reminder": "💾 ඉරිදා උපස්ථ මතක් කිරීම",
  // phone notifications
  "💧 Water time": "💧 වතුර බොන වේලාව", "A glass now keeps energy and focus up.": "දැන් වතුර වීදුරුවක් ශක්තිය සහ අවධානය රැක දෙයි.",
  "Your brief is ready: sleep, first task, water and today's affirmation.": "ඔබේ සාරාංශය සූදානම්: නින්ද, පළමු කාර්යය, ජලය සහ අද දවසේ ප්‍රකාශය.",
  "Fill in today's hours, note 3 good things, and put the phone away.": "අද පැය සටහන් කරන්න, හොඳ දේවල් 3ක් ලියන්න, දුරකථනය පසෙකින් තබන්න.",
  "✨ Your affirmation": "✨ ඔබේ ධනාත්මක ප්‍රකාශය", "Take 20 seconds to read today's affirmation and picture one action.": "තත්පර 20ක් ගෙන අද ප්‍රකාශය කියවා එක් ක්‍රියාවක් සිතන්න.",
  "🗓 Your week in review": "🗓 ඔබේ සතියේ සමාලෝචනය", "Score, wins and one change for next week. Takes 1 minute.": "ලකුණු, ජයග්‍රහණ සහ ලබන සතියට එක් වෙනසක්. විනාඩියක් පමණි.",
  "💾 Weekly backup": "💾 සතිපතා උපස්ථය", "Export your Sakuna data to keep a copy safe.": "ඔබේ සකුණ දත්ත අපනයනය කර පිටපතක් ආරක්ෂිතව තබා ගන්න.",
  // water, mindset
  "Other amount (ml)": "වෙනත් ප්‍රමාණයක් (ml)", "🔔 Remind me every 2 hours (10:00–20:00)": "🔔 පැය 2කට වරක් මතක් කරන්න (10:00–20:00)",
  "✨ I read my affirmations": "✨ මම ප්‍රකාශ කියෙව්වා", "Save my plan": "මගේ සැලැස්ම සුරකින්න", "Write in the present tense: “I am…”, “I wake up…”": "වර්තමාන කාලයෙන් ලියන්න: “මම…”",
  "Goal reached 💧": "ඉලක්කය සපුරා ගත්තා 💧", "Long-press to remove a mistake.": "වැරදීමක් ඉවත් කිරීමට දිගු වේලාවක් ඔබන්න.",
  "THIS WEEK": "මෙම සතිය", "TODAY": "අද", "✨ Affirm": "✨ ප්‍රකාශ", "✍️ Script": "✍️ ලියන්න", "🎯 WOOP": "🎯 WOOP", "🙏 Thanks": "🙏 ස්තූතිය",
};

let scale = TEXT_SIZES[theme().text].scale;
let lang: Lang = theme().lang;
subscribe(() => { const t = theme(); scale = TEXT_SIZES[t.text].scale; lang = t.lang; });

/** Sinhala for a label when Sinhala is on (for places that build strings in code). */
export function tr(s: string): string { return lang === "si" ? SI[s] || s : s; }
export const LANG_NAMES = LANGS;

type Props = Record<string, unknown> & { children?: unknown; style?: unknown; placeholder?: unknown };
function adjust(type: unknown, props: Props): Props {
  if (type !== Text && type !== TextInput) return props;
  let p = props;
  if (lang === "si") {
    const c = p.children;
    if (typeof c === "string" && SI[c]) p = { ...p, children: SI[c] };
    else if (Array.isArray(c) && c.some(x => typeof x === "string" && SI[x])) p = { ...p, children: c.map(x => (typeof x === "string" && SI[x] ? SI[x] : x)) };
    if (typeof p.placeholder === "string" && SI[p.placeholder]) p = { ...p, placeholder: SI[p.placeholder] };
  }
  if (scale !== 1) {
    const flat = (StyleSheet.flatten(p.style as never) || {}) as { fontSize?: number; lineHeight?: number };
    const extra: { fontSize: number; lineHeight?: number } = { fontSize: (flat.fontSize ?? 14) * scale };
    if (flat.lineHeight) extra.lineHeight = flat.lineHeight * scale;
    p = { ...p, style: [p.style, extra] };
  }
  return p;
}

type JsxFn = (type: unknown, props: Props, ...rest: unknown[]) => unknown;
function install(mod: Record<string, unknown> | undefined, names: string[]) {
  if (!mod) return;
  for (const n of names) {
    const orig = mod[n] as JsxFn | undefined;
    if (typeof orig !== "function" || (orig as unknown as { __sakuna?: boolean }).__sakuna) continue;
    const wrapped: JsxFn = (type, props, ...rest) => orig(type, props ? adjust(type, props) : props, ...rest);
    (wrapped as unknown as { __sakuna: boolean }).__sakuna = true;
    try { mod[n] = wrapped; } catch { /* read-only: stay English / normal size */ }
  }
}
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  install(require("react/jsx-runtime"), ["jsx", "jsxs"]);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  install(require("react/jsx-dev-runtime"), ["jsxDEV"]);
} catch { /* not available */ }
