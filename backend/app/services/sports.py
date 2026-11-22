"""Sports pathways: karate, kickboxing, Muay Thai, boxing and swimming, from first class to a solid level.

Plain data, no AI. Costs are LKR ESTIMATES for Sri Lanka (check with the club). Links are only search links
(Google Maps / YouTube) that always resolve, so nothing is invented. Contact sports need a qualified coach and
a doctor's OK if you have heart, joint or head-injury history.
"""
from __future__ import annotations

from urllib.parse import quote_plus

COMMON_SAFETY = [
    "Get a doctor's OK first if you have heart problems, high blood pressure, past concussions, or joint injuries.",
    "Warm up 10 minutes and cool down 5; stop at sharp pain, dizziness or chest pain.",
    "Learn from a qualified coach in person; videos are for revision, not for learning contact or falls.",
    "Drink water, and don't train hard on the day after a poor night's sleep or when sick.",
]

SPORTS: dict[str, dict] = {
    "karate": {
        "name": "Karate", "icon": "🥋", "kind": "martial art",
        "what": "Japanese striking art built on basics (kihon), forms (kata) and sparring (kumite); belt grades every few months.",
        "good_for": ["discipline", "flexibility", "self-defence basics", "confidence"],
        "stages": [
            {"name": "White to yellow belt", "weeks": "0-12", "focus": "Stances, punches, blocks, front kick, first kata, etiquette"},
            {"name": "Orange to green belt", "weeks": "12-52", "focus": "Combinations, more kata, controlled light sparring"},
            {"name": "Blue to brown belt", "weeks": "1-3 years", "focus": "Advanced kata, timing and distance, competition if you want"},
            {"name": "Black belt (Shodan)", "weeks": "3-5 years", "focus": "Usually 3-5 years of regular training"},
        ],
        "week": ["2 dojo classes (60-90 min)", "1 home session: 20 min kata + 10 min stretching"],
        "equipment": [("Gi (uniform)", 4000, 9000, True), ("Mouthguard", 800, 2500, False), ("Mitts and shin guards (for sparring)", 5000, 12000, False)],
        "monthly_fee": (3000, 8000), "grading_fee": (2000, 6000),
        "online_ok": "Good for kata and stretching revision once a coach has taught you the moves.",
        "needs_instructor": "Sparring, falls and gradings need a real instructor.",
        "search": "karate dojo", "video": "karate beginner basics kihon",
        "safety": ["Use a mouthguard and gloves for any sparring.", "Control: no full-power contact as a beginner."],
    },
    "kickboxing": {
        "name": "Kickboxing", "icon": "🥊", "kind": "martial art",
        "what": "Punches plus kicks, trained on pads and bags; great conditioning even if you never compete.",
        "good_for": ["fitness and fat loss", "stress relief", "coordination", "self-defence basics"],
        "stages": [
            {"name": "Foundations", "weeks": "0-8", "focus": "Stance, jab-cross, hooks, roundhouse kick, footwork, guard"},
            {"name": "Combinations & pads", "weeks": "8-24", "focus": "3-4 hit combos, checking kicks, conditioning rounds"},
            {"name": "Light sparring", "weeks": "6-12 months", "focus": "Controlled technical sparring with full protective gear"},
            {"name": "Amateur bouts (optional)", "weeks": "12+ months", "focus": "Only with your coach's OK and a medical check"},
        ],
        "week": ["2-3 gym classes (60 min)", "1 run or skipping session 20-30 min"],
        "equipment": [("Hand wraps", 800, 2000, True), ("Boxing gloves 12-16 oz", 6000, 18000, True), ("Shin guards", 5000, 12000, False),
                      ("Mouthguard", 800, 2500, False)],
        "monthly_fee": (5000, 15000), "grading_fee": None,
        "online_ok": "Shadow boxing, skipping and conditioning work well at home.",
        "needs_instructor": "Pad work, checking kicks and all sparring need a coach.",
        "search": "kickboxing gym", "video": "kickboxing for beginners basics",
        "safety": ["Always wrap your hands before bag or pad work.", "Sparring only in full gear and under supervision."],
    },
    "muay_thai": {
        "name": "Muay Thai", "icon": "🇹🇭", "kind": "martial art",
        "what": "Thai boxing: the 'art of eight limbs' using fists, elbows, knees and shins, plus clinch work.",
        "good_for": ["serious conditioning", "toughness", "self-defence", "discipline"],
        "stages": [
            {"name": "Foundations", "weeks": "0-8", "focus": "Stance, teep (push kick), roundhouse, knees, guard, basic clinch"},
            {"name": "Pads & clinch", "weeks": "8-24", "focus": "Thai pad rounds, elbows and knees (controlled), conditioning"},
            {"name": "Technical sparring", "weeks": "6-12 months", "focus": "Light, controlled sparring; usually no elbows"},
            {"name": "Inter-club / amateur (optional)", "weeks": "12+ months", "focus": "With coach approval and a medical"},
        ],
        "week": ["2-3 classes (60-90 min)", "2 runs of 20-30 min (traditional Thai conditioning)"],
        "equipment": [("Hand wraps", 800, 2000, True), ("Gloves 12-16 oz", 6000, 18000, True), ("Shin guards", 5000, 12000, False),
                      ("Mouthguard", 800, 2500, False), ("Groin guard", 2000, 5000, False)],
        "monthly_fee": (6000, 15000), "grading_fee": None,
        "online_ok": "Shadow work, conditioning and stretching.",
        "needs_instructor": "Kicks on pads, clinch and sparring need a coach in person.",
        "search": "muay thai gym", "video": "muay thai beginner basics roundhouse teep",
        "safety": ["Condition shins gradually; never kick hard objects to 'toughen' them.", "Elbows and knees only on pads until your coach says otherwise."],
    },
    "boxing": {
        "name": "Boxing", "icon": "🥊", "kind": "combat sport",
        "what": "Punching, footwork and head movement; superb cardio and coordination.",
        "good_for": ["cardio", "coordination", "confidence", "stress relief"],
        "stages": [
            {"name": "Foundations", "weeks": "0-8", "focus": "Stance, jab, cross, hook, uppercut, footwork, defence (block, slip)"},
            {"name": "Combinations & bag work", "weeks": "8-24", "focus": "Combos with movement, rounds on the bag and mitts"},
            {"name": "Technical sparring", "weeks": "6-12 months", "focus": "Light sparring with headgear, gloves and a coach"},
            {"name": "Amateur (optional)", "weeks": "12+ months", "focus": "Medical check and coach approval required"},
        ],
        "week": ["2-3 sessions (60 min)", "2 runs or skipping 20 min"],
        "equipment": [("Hand wraps", 800, 2000, True), ("Gloves 12-16 oz", 6000, 18000, True), ("Mouthguard", 800, 2500, False),
                      ("Headgear (sparring)", 6000, 15000, False)],
        "monthly_fee": (4000, 12000), "grading_fee": None,
        "online_ok": "Shadow boxing, footwork drills and skipping at home.",
        "needs_instructor": "Mitts, defence under pressure and all sparring.",
        "search": "boxing club", "video": "boxing for beginners stance jab cross",
        "safety": ["Head contact carries concussion risk: keep sparring light and stop after any head knock.", "Wrap hands every session."],
    },
    "swimming": {
        "name": "Swimming", "icon": "🏊", "kind": "sport",
        "what": "Full-body, low-impact fitness and a life-saving skill. Learn breathing first, then freestyle, then other strokes.",
        "good_for": ["safety in water", "cardio", "joints-friendly fitness", "relaxation"],
        "stages": [
            {"name": "Water confidence", "weeks": "0-4", "focus": "Breathing out under water, floating, gliding, standing up safely"},
            {"name": "Freestyle basics", "weeks": "4-10", "focus": "Kick, arm stroke, side breathing; swim 25 m"},
            {"name": "Endurance", "weeks": "10-24", "focus": "Swim 200 m, then 500 m without stopping; add backstroke"},
            {"name": "Strong swimmer", "weeks": "6-12 months", "focus": "1 km continuous, breaststroke, open-water skills with a group"},
        ],
        "week": ["2-3 pool sessions (30-45 min)", "Start with lessons; then 1 lesson + 2 practice sessions"],
        "equipment": [("Swimsuit / jammers", 2500, 8000, True), ("Goggles", 1500, 5000, True), ("Swim cap", 600, 2500, True),
                      ("Kickboard (often provided)", 1500, 4000, False)],
        "monthly_fee": (4000, 12000), "grading_fee": None,
        "online_ok": "Videos help with stroke technique once you're safe in water.",
        "needs_instructor": "Learn to swim with a qualified instructor or lifeguard present; never alone.",
        "search": "swimming pool lessons", "video": "learn freestyle swimming adult beginner breathing",
        "safety": ["Never swim alone or in unsupervised water while learning.", "Sea: swim only at lifeguarded beaches, between flags; watch for rip currents.",
                   "Don't swim after alcohol or a heavy meal."],
    },
}


def _links(s: dict, city: str) -> dict:
    return {"find_near_you": f"https://www.google.com/maps/search/{quote_plus(s['search'] + ' ' + city)}",
            "videos": f"https://www.youtube.com/results?search_query={quote_plus(s['video'])}"}


def catalogue() -> list[dict]:
    return [{"key": k, "name": s["name"], "icon": s["icon"], "kind": s["kind"], "what": s["what"], "good_for": s["good_for"]} for k, s in SPORTS.items()]


def pathway(key: str, city: str = "Colombo") -> dict | None:
    s = SPORTS.get(key)
    if not s:
        return None
    eq = [{"item": n, "lkr_min": lo, "lkr_max": hi, "needed_from_day_one": must} for n, lo, hi, must in s["equipment"]]
    start_min = sum(e["lkr_min"] for e in eq if e["needed_from_day_one"]) + s["monthly_fee"][0]
    start_max = sum(e["lkr_max"] for e in eq if e["needed_from_day_one"]) + s["monthly_fee"][1]
    first_month = [f"Week 1: find 2-3 {s['search']}s near you and ask for a trial class.", "Week 1-2: attend the trial; ask about the coach's qualifications and safety rules.",
                   f"Week 2-4: commit to {s['week'][0]}; buy only the day-one gear.", "Week 4: note what improved and set a goal for the next 3 months."]
    return {"key": key, **{k: s[k] for k in ("name", "icon", "kind", "what", "good_for", "stages", "week", "online_ok", "needs_instructor")},
            "equipment": eq, "monthly_fee_lkr": {"min": s["monthly_fee"][0], "max": s["monthly_fee"][1]},
            "grading_fee_lkr": {"min": s["grading_fee"][0], "max": s["grading_fee"][1]} if s["grading_fee"] else None,
            "first_month_cost_lkr": {"min": start_min, "max": start_max}, "first_month": first_month,
            "safety": s["safety"] + COMMON_SAFETY, "links": _links(s, city),
            "choose_a_club": ["Coach has a recognised qualification or federation membership", "Beginners' class, not mixed with fighters",
                              "Clean mats or pool, first-aid kit, supervision", "A free or cheap trial class", "No pressure to spar or compete early"],
            "goal_plan": {"title": f"Learn {s['name']}", "category": "health", "horizon": "year", "milestones": [{"title": st["name"]} for st in s["stages"]], "why": f"{', '.join(s['good_for'][:2]).capitalize()}",
                          "success": s["stages"][2]["name"] + ": " + s["stages"][2]["focus"], "next_action": first_month[0][len('Week 1: '):]},
            "note": "Costs are estimates for Sri Lanka in LKR; ask the club for current prices."}
