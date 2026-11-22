"""Exercise library and weekly workout plans (plain data). Video links are YouTube *search* links, never invented titles."""
from __future__ import annotations

from urllib.parse import quote_plus

# name, muscles, equipment, level(1-3), sets, reps, rest s, technique, mistakes, easier
_E = [
    ("Barbell back squat", ["quads", "glutes", "core"], "barbell", 2, 4, "6-8", 120, ["Feet shoulder-width, bar on upper back", "Brace, sit hips back and down", "Knees track over toes, hips to knee height", "Drive up through mid-foot"], ["Knees caving in", "Heels lifting", "Rounding the lower back"], "Goblet squat"),
    ("Goblet squat", ["quads", "glutes"], "dumbbell", 1, 3, "10-12", 90, ["Hold a dumbbell at your chest", "Sit down between your knees", "Chest up, elbows inside knees", "Stand tall and squeeze glutes"], ["Leaning forward", "Half reps"], "Bodyweight squat"),
    ("Bodyweight squat", ["quads", "glutes"], "none", 1, 3, "12-20", 60, ["Arms forward for balance", "Hips back, chest up", "Thighs to parallel if comfortable", "Stand up fully"], ["Knees caving in", "Rushing"], "Box squat to a chair"),
    ("Romanian deadlift", ["hamstrings", "glutes", "lower back"], "barbell", 2, 3, "8-10", 120, ["Soft knees, bar close to legs", "Push hips back until hamstrings stretch", "Keep a flat back", "Drive hips forward to stand"], ["Rounding the back", "Bending the knees too much", "Bar drifting away"], "Dumbbell RDL"),
    ("Deadlift", ["back", "glutes", "hamstrings"], "barbell", 3, 3, "5", 180, ["Bar over mid-foot, shins close", "Grip, chest up, brace hard", "Push the floor away", "Lock out with glutes, not the lower back"], ["Jerking the bar", "Round back", "Hyper-extending at the top"], "Romanian deadlift with light weight"),
    ("Hip thrust", ["glutes", "hamstrings"], "barbell", 1, 3, "10-12", 90, ["Upper back on a bench, bar on hips", "Chin tucked, ribs down", "Drive hips up to a straight line", "Pause and squeeze"], ["Arching the lower back", "Feet too far"], "Glute bridge"),
    ("Walking lunge", ["quads", "glutes"], "dumbbell", 1, 3, "10 each leg", 90, ["Long step forward", "Back knee towards the floor", "Front knee over the ankle", "Push through the front heel"], ["Short steps", "Knee caving in"], "Static split squat"),
    ("Leg press", ["quads", "glutes"], "machine", 1, 3, "10-12", 90, ["Feet mid-platform", "Lower until knees ~90°", "Don't lock the knees", "Push evenly through both feet"], ["Lower back lifting off the pad", "Locking knees"], "Bodyweight squat"),
    ("Calf raise", ["calves"], "none", 1, 3, "15-20", 45, ["Balls of feet on a step", "Full stretch at the bottom", "Rise as high as possible", "Pause at the top"], ["Bouncing", "Short range"], "Two-leg calf raise on the floor"),
    ("Bench press", ["chest", "triceps", "shoulders"], "barbell", 2, 4, "6-8", 120, ["Eyes under the bar, shoulder blades pinched", "Lower to mid-chest", "Elbows ~45° from the body", "Press up and slightly back"], ["Bouncing off the chest", "Flared elbows", "Feet floating"], "Dumbbell bench press"),
    ("Dumbbell bench press", ["chest", "triceps"], "dumbbell", 1, 3, "8-12", 90, ["Dumbbells at chest level", "Press up and together", "Lower slowly with control"], ["Dropping too low", "Uneven arms"], "Push-up"),
    ("Push-up", ["chest", "triceps", "core"], "none", 1, 3, "8-15", 60, ["Hands under shoulders", "Body in a straight line", "Chest to a fist's height from the floor", "Push the floor away"], ["Sagging hips", "Head dropping", "Half reps"], "Incline push-up on a table"),
    ("Incline dumbbell press", ["upper chest", "shoulders"], "dumbbell", 2, 3, "8-12", 90, ["Bench at 30°", "Press over the upper chest", "Control the lowering"], ["Bench too steep", "Arching"], "Push-up with feet on the floor"),
    ("Overhead press", ["shoulders", "triceps", "core"], "barbell", 2, 3, "6-8", 120, ["Bar on the front of the shoulders", "Squeeze glutes, ribs down", "Press straight up, head through", "Lock out overhead"], ["Leaning back", "Pressing forward"], "Seated dumbbell press"),
    ("Lateral raise", ["shoulders"], "dumbbell", 1, 3, "12-15", 60, ["Slight bend in elbows", "Raise to shoulder height", "Lead with elbows", "Lower slowly"], ["Swinging", "Shrugging"], "Band lateral raise"),
    ("Pull-up", ["back", "biceps"], "bar", 3, 3, "5-8", 120, ["Full hang, hands shoulder-width", "Pull elbows to ribs", "Chin over the bar", "Lower fully"], ["Kipping", "Half reps"], "Lat pulldown or band-assisted pull-up"),
    ("Lat pulldown", ["back", "biceps"], "machine", 1, 3, "10-12", 90, ["Grip slightly wider than shoulders", "Chest up, pull to the upper chest", "Squeeze shoulder blades", "Control up"], ["Leaning far back", "Pulling behind the neck"], "Band pulldown"),
    ("Bent-over row", ["back", "biceps"], "barbell", 2, 3, "8-10", 90, ["Hinge to ~45°, flat back", "Pull to the lower ribs", "Squeeze, then lower with control"], ["Rounding the back", "Using momentum"], "One-arm dumbbell row"),
    ("One-arm dumbbell row", ["back", "biceps"], "dumbbell", 1, 3, "10 each arm", 60, ["Hand and knee on a bench", "Pull the dumbbell to the hip", "Don't twist the torso"], ["Rotating", "Short pulls"], "Band row"),
    ("Face pull", ["rear shoulders", "upper back"], "cable", 1, 3, "12-15", 60, ["Rope at face height", "Pull towards the eyes, elbows high", "Rotate hands back"], ["Elbows dropping", "Too heavy"], "Band pull-apart"),
    ("Biceps curl", ["biceps"], "dumbbell", 1, 3, "10-12", 60, ["Elbows by your sides", "Curl without swinging", "Lower slowly"], ["Swinging the body", "Elbows moving forward"], "Band curl"),
    ("Triceps dip", ["triceps", "chest"], "bench", 2, 3, "8-12", 60, ["Hands on a bench behind you", "Lower until elbows ~90°", "Press up"], ["Shoulders rolling forward", "Going too deep"], "Triceps rope pushdown"),
    ("Plank", ["core"], "none", 1, 3, "30-60 s", 45, ["Elbows under shoulders", "Squeeze glutes and abs", "Straight line head to heels", "Breathe steadily"], ["Hips sagging", "Hips too high", "Holding breath"], "Plank on knees"),
    ("Dead bug", ["core"], "none", 1, 3, "8 each side", 45, ["Lie on back, arms up, knees at 90°", "Lower opposite arm and leg slowly", "Keep the lower back on the floor"], ["Back arching", "Moving too fast"], "Single-leg dead bug"),
    ("Hanging knee raise", ["core", "hip flexors"], "bar", 2, 3, "10-12", 60, ["Hang still", "Curl knees to chest", "Lower without swinging"], ["Swinging", "Using momentum"], "Lying leg raise"),
    ("Mountain climber", ["core", "cardio"], "none", 1, 3, "30 s", 30, ["High plank", "Drive knees to chest quickly", "Keep hips low"], ["Hips high", "Bouncing"], "Slow mountain climber"),
    ("Burpee", ["full body", "cardio"], "none", 2, 3, "8-12", 60, ["Squat, hands down", "Jump feet back to plank", "Jump feet in, explode up"], ["Sagging plank", "Landing hard"], "Step-back burpee"),
    ("Brisk walk / incline walk", ["cardio"], "none", 1, 1, "30-45 min", 0, ["Walk fast enough to breathe harder but still talk", "Incline treadmill 5-10% if available"], ["Holding the treadmill rails"], "10-minute walks after each meal"),
]
EXERCISES = [{"name": n, "muscles": m, "equipment": e, "level": lv, "sets": s, "reps": r, "rest_s": rest, "technique": tech, "mistakes": mis, "easier": easy,
              "video_search": f"https://www.youtube.com/results?search_query={quote_plus(n + ' proper form tutorial')}"} for n, m, e, lv, s, r, rest, tech, mis, easy in _E]
BY_NAME = {e["name"]: e for e in EXERCISES}

PLANS = {
    "full_body": {"title": "Full body A/B · beginner · 3 days", "days": {1: "A", 3: "B", 5: "A"},
                  "workouts": {"A": ["Goblet squat", "Dumbbell bench press", "One-arm dumbbell row", "Romanian deadlift", "Plank"],
                               "B": ["Walking lunge", "Overhead press", "Lat pulldown", "Hip thrust", "Dead bug"]}},
    "fat_loss": {"title": "Fat loss · strength + cardio · 4 days", "days": {1: "A", 2: "C", 4: "B", 6: "C"},
                 "workouts": {"A": ["Goblet squat", "Push-up", "One-arm dumbbell row", "Hip thrust", "Mountain climber"],
                              "B": ["Romanian deadlift", "Incline dumbbell press", "Lat pulldown", "Walking lunge", "Plank"],
                              "C": ["Brisk walk / incline walk", "Burpee", "Dead bug"]}},
    "upper_lower": {"title": "Upper / lower · intermediate · 4 days", "days": {1: "U", 2: "L", 4: "U", 5: "L"},
                    "workouts": {"U": ["Bench press", "Bent-over row", "Overhead press", "Lat pulldown", "Lateral raise", "Biceps curl", "Triceps dip"],
                                 "L": ["Barbell back squat", "Romanian deadlift", "Leg press", "Walking lunge", "Calf raise", "Hanging knee raise"]}},
    "home": {"title": "Home · no equipment · 3 days", "days": {1: "H", 3: "H", 5: "H"},
             "workouts": {"H": ["Bodyweight squat", "Push-up", "Walking lunge", "Plank", "Mountain climber", "Burpee"]}},
}


def library(muscle: str | None = None, equipment: str | None = None, level: int | None = None) -> list[dict]:
    out = EXERCISES
    if muscle:
        out = [e for e in out if any(muscle.lower() in m for m in e["muscles"])]
    if equipment:
        out = [e for e in out if e["equipment"] == equipment]
    if level:
        out = [e for e in out if e["level"] <= level]
    return out


def plans() -> list[dict]:
    return [{"key": k, "title": p["title"], "days_per_week": len(p["days"])} for k, p in PLANS.items()]


def today(plan: str, weekday: int) -> dict:
    """weekday: 1 = Monday ... 7 = Sunday."""
    p = PLANS.get(plan) or PLANS["full_body"]
    key = p["days"].get(weekday)
    if not key:
        nxt = min((d for d in p["days"] if d > weekday), default=min(p["days"]))
        return {"plan": p["title"], "rest_day": True, "next_day": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][nxt - 1],
                "tip": "Rest day: walk 30 minutes, stretch and sleep well. Muscles grow on rest days.", "exercises": []}
    return {"plan": p["title"], "rest_day": False, "workout": key, "exercises": [BY_NAME[n] for n in p["workouts"][key]],
            "warmup": ["5 min easy cardio", "2 light sets of the first exercise"], "tip": "Leave 1-2 reps in reserve; add a little weight when you hit the top of the rep range."}
