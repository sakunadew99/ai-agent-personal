"""Sri Lankan, budget-friendly weekly meal planner (plain maths) and a shopping list.

Food values are typical per-portion estimates (kcal, protein, LKR); prices vary by shop and season, so the costs are
estimates. Targets: Mifflin-St Jeor when height/age/sex are given, otherwise ~30 kcal per kg; protein 1.6 g/kg when
losing fat or building muscle, 1.2 g/kg to maintain. Not medical advice: see a doctor or dietitian for conditions.
"""
from __future__ import annotations

FOODS = {  # key: (name, portion, kcal, protein g, cost LKR, tags)
    "rice": ("Rice (white or red)", "1 cup cooked", 255, 5.0, 65, {"carb"}),
    "string_hoppers": ("String hoppers", "10 pieces", 280, 6.0, 150, {"carb"}),
    "egg_hopper": ("Egg hopper", "1", 160, 7.0, 90, {"egg"}),
    "pol_roti": ("Pol roti", "2", 400, 8.0, 120, {"carb"}),
    "bread": ("Wholemeal bread", "2 slices", 160, 6.0, 50, {"carb"}),
    "oats": ("Oats", "50 g dry", 190, 7.0, 90, {"carb"}),
    "egg": ("Boiled egg", "1", 75, 6.5, 55, {"egg"}),
    "chicken": ("Chicken curry (breast)", "120 g", 230, 30.0, 330, {"meat"}),
    "fish": ("Fish curry (tuna / thalapath)", "120 g", 180, 28.0, 360, {"fish"}),
    "sprats": ("Sprats (haal masso) tempered", "40 g dry", 150, 22.0, 90, {"fish"}),
    "dhal": ("Dhal curry", "1 cup", 230, 14.0, 70, {"veg_protein"}),
    "chickpeas": ("Chickpeas (kadala)", "1 cup boiled", 270, 14.0, 120, {"veg_protein"}),
    "green_gram": ("Green gram (mung)", "1 cup boiled", 210, 14.0, 90, {"veg_protein"}),
    "soya": ("Soya meat curry", "50 g dry", 170, 26.0, 90, {"veg_protein"}),
    "curd": ("Curd (no treacle)", "100 g", 100, 4.0, 90, {"dairy"}),
    "milk": ("Milk", "1 glass", 150, 8.0, 100, {"dairy"}),
    "yoghurt": ("Plain yoghurt", "1 cup", 120, 7.0, 90, {"dairy"}),
    "veg_curry": ("Vegetable curry (beans, carrot, pumpkin)", "1 cup", 90, 3.0, 80, {"veg"}),
    "gotukola": ("Gotukola mallum", "1/2 cup", 60, 2.0, 50, {"veg"}),
    "salad": ("Salad (cucumber, tomato)", "1 bowl", 40, 1.0, 60, {"veg"}),
    "banana": ("Banana (ambul)", "2", 180, 2.2, 60, {"fruit"}),
    "papaya": ("Papaya", "1 cup", 60, 0.7, 60, {"fruit"}),
    "peanuts": ("Peanuts (roasted)", "30 g", 170, 7.0, 50, {"nuts"}),
    "pol_sambol": ("Pol sambol", "2 tbsp", 80, 1.0, 30, {"side"}),
}
MEALS = {
    "breakfast": [["string_hoppers", "dhal", "egg"], ["oats", "milk", "banana"], ["bread", "egg", "egg", "papaya"],
                  ["pol_roti", "dhal"], ["egg_hopper", "egg_hopper", "pol_sambol"], ["green_gram", "pol_sambol", "papaya"]],
    "lunch": [["rice", "chicken", "veg_curry", "gotukola"], ["rice", "fish", "veg_curry", "salad"], ["rice", "dhal", "soya", "veg_curry"],
              ["rice", "sprats", "dhal", "gotukola"], ["rice", "chickpeas", "veg_curry", "salad"]],
    "dinner": [["string_hoppers", "chicken", "salad"], ["rice", "fish", "gotukola"], ["bread", "egg", "egg", "salad"],
               ["rice", "soya", "veg_curry"], ["pol_roti", "dhal", "egg"]],
    "snack": [["banana", "peanuts"], ["curd"], ["yoghurt", "papaya"], ["chickpeas"], ["milk"], ["egg", "egg"]],
}
# cheaper swaps, biggest saving first (used only when a daily budget is set)
CHEAPER = [("chicken", "soya"), ("fish", "sprats"), ("string_hoppers", "rice"), ("pol_roti", "bread"), ("egg_hopper", "egg"),
           ("yoghurt", "curd"), ("milk", "curd"), ("chickpeas", "dhal")]
EXCLUDE = {"vegetarian": {"meat", "fish"}, "pescatarian": {"meat"}, "no_egg": {"egg"}, "no_dairy": {"dairy"}}
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def targets(weight_kg: float, goal: str, height_cm: float | None = None, age: int | None = None, sex: str | None = None, activity: float = 1.45) -> dict:
    if height_cm and age and sex in ("male", "female"):
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + (5 if sex == "male" else -161)
        maint, method = bmr * activity, "Mifflin-St Jeor"
    else:
        maint, method = weight_kg * 30, "about 30 kcal per kg"
    kcal = maint + {"lose": -450, "maintain": 0, "gain": 300}[goal]
    floor = {"male": 1500, "female": 1200}.get(sex or "", 1400)          # don't plan below a safe minimum without supervision
    floored = goal == "lose" and kcal < floor
    kcal = max(kcal, floor) if goal == "lose" else kcal
    protein = weight_kg * (1.2 if goal == "maintain" else 1.6)
    return {"kcal": round(kcal), "protein_g": round(protein), "maintenance_kcal": round(maint), "method": method,
            **({"floor_note": f"Kept at {floor} kcal: eating less than this should be supervised by a doctor or dietitian."} if floored else {})}


def _allowed(item: str, avoid: set[str]) -> bool:
    return not (FOODS[item][5] & avoid)


class _Day:
    def __init__(self, day_idx: int, avoid: set[str]):
        self.avoid = avoid
        self.slots: dict[str, list[list]] = {}
        for slot, options in MEALS.items():
            ok = [o for o in options if all(_allowed(i, avoid) for i in o)] or [["rice", "veg_curry", "salad"]]
            self.slots[slot] = [[i, 1.0] for i in ok[(day_idx + len(slot)) % len(ok)]]

    def total(self, col: int) -> float:
        return sum(FOODS[i][col] * q for s in self.slots.values() for i, q in s)

    def swap_for_budget(self, limit: float) -> None:
        for exp, cheap in CHEAPER:
            if self.total(4) <= limit:
                return
            if _allowed(cheap, self.avoid):
                for s in self.slots.values():
                    for p in s:
                        if p[0] == exp:
                            p[0] = cheap


def _day(day_idx: int, t: dict, avoid: set[str], budget: float | None) -> dict:
    d = _Day(day_idx, avoid)
    if budget:
        d.swap_for_budget(budget * 0.8)                                       # leave room for protein top-ups
    # 1) protein: top up with the densest cheap protein you eat, alternating soya and eggs when both are allowed
    extras = [x for x in ("soya", "egg") if _allowed(x, avoid)] + [x for x in ("green_gram", "dhal") if _allowed(x, avoid)]
    for k in range(6):
        if d.total(3) >= t["protein_g"] - 3:
            break
        d.slots["snack"].append([extras[k % min(2, len(extras))], 1.0])
    # 2) energy: scale the carb portions (rice, hoppers, roti, bread, oats) in half-portion steps, 0.5 to 2.5
    carbs = [p for s in d.slots.values() for p in s if "carb" in FOODS[p[0]][5]]
    if carbs:
        carb_kcal = sum(FOODS[i][2] * q for i, q in carbs)
        factor = max(0.25, min(2.5, 1 + (t["kcal"] - d.total(2)) / max(1, carb_kcal)))
        for p in carbs:
            p[1] = max(0.5, min(2.5, round(p[1] * factor * 2) / 2))
    # 3) still too much energy (small body, low target): drop optional snacks and sides first, never the protein
    for slot in ("snack", "breakfast", "lunch", "dinner"):
        for item in ("peanuts", "banana", "pol_sambol", "milk", "yoghurt", "curd", "papaya"):
            if d.total(2) <= t["kcal"] * 1.04:
                break
            for p in list(d.slots[slot]):
                if p[0] == item and d.total(2) > t["kcal"] * 1.04:
                    d.slots[slot].remove(p)
    if budget:
        d.swap_for_budget(budget)
    cost = d.total(4)
    meals = [{"slot": slot, "items": [{"key": i, "name": FOODS[i][0], "portion": FOODS[i][1], "qty": q} for i, q in items],
              "kcal": round(sum(FOODS[i][2] * q for i, q in items)), "protein_g": round(sum(FOODS[i][3] * q for i, q in items), 1)}
             for slot, items in d.slots.items()]
    return {"day": DAYS[day_idx], "meals": meals, "kcal": round(d.total(2)), "protein_g": round(d.total(3)), "cost_lkr": round(cost),
            "within_budget": (cost <= budget) if budget else None}


def week_plan(weight_kg: float, goal: str = "lose", budget_lkr_day: float | None = None, diet: list[str] | None = None,
              height_cm: float | None = None, age: int | None = None, sex: str | None = None) -> dict:
    t = targets(weight_kg, goal, height_cm, age, sex)
    avoid: set[str] = set()
    for d in diet or []:
        avoid |= EXCLUDE.get(d, set())
    days = [_day(i, t, avoid, budget_lkr_day) for i in range(7)]
    shop: dict[str, float] = {}
    for d in days:
        for m in d["meals"]:
            for it in m["items"]:
                shop[it["key"]] = shop.get(it["key"], 0) + it["qty"]
    shopping = sorted(({"item": FOODS[k][0], "portions": q, "portion": FOODS[k][1], "cost_lkr": round(FOODS[k][4] * q)} for k, q in shop.items()),
                      key=lambda x: -x["cost_lkr"])
    week_cost = sum(d["cost_lkr"] for d in days)
    over = [d["day"] for d in days if d["within_budget"] is False]
    return {"targets": t, "days": days, "shopping": shopping, "week_cost_lkr": week_cost, "avg_day_cost_lkr": round(week_cost / 7),
            "avg_kcal": round(sum(d["kcal"] for d in days) / 7), "avg_protein_g": round(sum(d["protein_g"] for d in days) / 7),
            "budget_note": (f"{len(over)} day(s) are above your budget even with the cheapest swaps; the gap is mostly protein. "
                            "Lower the protein target a little or raise the budget.") if over else None,
            "prep": ["Sunday: cook dhal, chickpeas and soya for 3 days; boil 6 eggs", "Wednesday: second batch of curries",
                     "Keep cut vegetables and fruit ready in the fridge", "Drink 2.5-3 L water a day (more on gym days)"],
            "note": "Portions and prices are typical estimates; adjust to your shop. Not medical advice; see a dietitian for health conditions."}
