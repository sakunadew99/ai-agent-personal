"""$1M financial freedom journey (projections) and the income-opportunity finder. Plain maths; no promises.

Projection: month by month, savings grow each year and earn a yearly return (compounded monthly). Three scenarios,
plus "how much a month to reach the target in N years". Money stays per currency: we convert LKR to USD only with the
exchange rate shown (from market data when available, or the one you enter).
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now_utc
from app.models.entities import CareerProfile, Expense, Goal, Income, Skill

SCENARIOS = [
    {"key": "conservative", "label": "Conservative", "return_pct": 5.0, "saving_growth_pct": 3.0, "note": "Bank deposits / bonds, small raises"},
    {"key": "realistic", "label": "Realistic", "return_pct": 8.0, "saving_growth_pct": 7.0, "note": "Diversified long-term investing, steady career growth"},
    {"key": "ambitious", "label": "Ambitious", "return_pct": 10.0, "saving_growth_pct": 12.0, "note": "Strong income growth (career + freelancing/business)"},
]
MAX_YEARS = 50


def project(current: float, monthly: float, return_pct: float, saving_growth_pct: float, target: float, years: int = 40) -> dict:
    """Month-by-month: value = value*(1+r/12) + saving; the saving grows once a year. Returns the path and when the target is reached."""
    value, saving, r = float(current), float(monthly), return_pct / 100 / 12
    path, reached = [{"year": 0, "value": round(value)}], None
    for m in range(1, MAX_YEARS * 12 + 1):
        value = value * (1 + r) + saving
        if reached is None and value >= target:
            reached = m
        if m % 12 == 0:
            if m // 12 <= years:
                path.append({"year": m // 12, "value": round(value)})
            saving *= 1 + saving_growth_pct / 100
        if reached is not None and m // 12 >= years:
            break
    return {"path": path, "months_to_target": reached, "years_to_target": round(reached / 12, 1) if reached else None}


def needed_monthly(current: float, target: float, years: int, return_pct: float, saving_growth_pct: float) -> float:
    """Smallest starting monthly saving that reaches the target in `years` (bisection on the same model)."""
    lo, hi = 0.0, max(target, 1.0)
    for _ in range(60):
        mid = (lo + hi) / 2
        res = project(current, mid, return_pct, saving_growth_pct, target, years)
        if res["months_to_target"] is not None and res["months_to_target"] <= years * 12:
            hi = mid
        else:
            lo = mid
    return round(hi, 2)


def _usd_lkr() -> tuple[float, str]:
    try:
        from app.services import portfolio_ai
        s = [v for _, v in portfolio_ai.yahoo("LKR=X")]
        if s:
            return round(s[-1], 2), "market (Yahoo Finance)"
    except Exception:  # noqa: BLE001 - offline is fine, the user can enter a rate
        pass
    return 300.0, "default (enter your own rate)"


def _avg_monthly_saving(db: Session, user_id, currency: str) -> float | None:
    since = now_utc() - timedelta(days=90)
    inc = sum(Decimal(r.amount) for r in db.scalars(select(Income).where(Income.user_id == user_id, Income.currency == currency, Income.record_kind == "actual", Income.received_at >= since)).all())
    exp = sum(Decimal(r.amount) for r in db.scalars(select(Expense).where(Expense.user_id == user_id, Expense.currency == currency, Expense.record_kind == "actual",
                                                                       Expense.category != "savings", Expense.spent_at >= since)).all())
    return round(float((inc - exp) / 3), 2) if inc else None


def million(db: Session, user_id, monthly_saving: float | None = None, usd_lkr: float | None = None, target_usd: float = 1_000_000,
            target_years: int = 15) -> dict:
    from app.services import smart
    rate, rate_source = (usd_lkr, "your rate") if usd_lkr else _usd_lkr()
    nw = smart.all_in_net_worth(db, user_id)
    current_usd, counted, skipped = 0.0, [], []
    for c in nw["currencies"]:
        total = float(c["total"])
        if c["currency"] == "USD":
            current_usd += total; counted.append(c)
        elif c["currency"] == "LKR":
            current_usd += total / rate; counted.append(c)
        else:
            skipped.append(c["currency"])
    guess = _avg_monthly_saving(db, user_id, "LKR")
    monthly_usd = (monthly_saving / rate) if monthly_saving is not None else ((guess / rate) if guess and guess > 0 else 100.0)
    scen = []
    for s in SCENARIOS:
        p = project(current_usd, monthly_usd, s["return_pct"], s["saving_growth_pct"], target_usd)
        scen.append({**s, **p, "needed_monthly_usd": {str(y): needed_monthly(current_usd, target_usd, y, s["return_pct"], s["saving_growth_pct"]) for y in (10, 15, 20)}})
    pct = max(0.0, min(100.0, current_usd / target_usd * 100))
    return {"target_usd": target_usd, "usd_lkr": rate, "rate_source": rate_source, "current_usd": round(current_usd, 2), "current_lkr": round(current_usd * rate),
            "progress_pct": round(pct, 3), "monthly_saving_usd": round(monthly_usd, 2), "monthly_saving_lkr": round(monthly_usd * rate),
            "monthly_saving_source": "your input" if monthly_saving is not None else ("your last 90 days (income − spending)" if guess and guess > 0 else "example: $100"),
            "scenarios": scen, "counted": [c["currency"] for c in counted], "not_counted": skipped,
            "milestones": [{"label": name, "usd": v, "reached": current_usd >= v} for name, v in (("Emergency fund (~$3k)", 3000), ("$10k", 10000), ("$50k", 50000),
                                                                                          ("$100k", 100000), ("$250k", 250000), ("$500k", 500000), ("$1M", 1_000_000))],
            "actions": {"daily": ["Log every expense (Quick add / receipt scan)", "One income-building action (proposal, portfolio, skill)"],
                        "weekly": ["Review spending vs budget", "Send 5 tailored proposals or applications", "Learn one money skill (15 min)"],
                        "monthly": ["Move savings first, on payday", "Check net worth", "Review subscriptions"],
                        "yearly": ["Ask for a raise / raise your rates", "Rebalance investments", "Update this projection"]},
            "roadmap": roadmap(current_usd, monthly_usd, rate, target_usd, target_years),
            "disclaimer": "Projections, not promises. Returns vary and can be negative; consult a licensed adviser for investment decisions."}


# ------------------------------------------------------------------ opportunities

OPPORTUNITIES = [
    {"id": "data_freelance", "title": "Data analytics freelancing", "skills": ["python", "sql", "excel", "power bi", "data", "analytics"],
     "what": "Dashboards, reports and data cleaning for small businesses on Fiverr/Upwork.", "cost_lkr": 0, "hours": 8, "difficulty": 2,
     "income_usd": (100, 1000), "risks": ["Low prices at first", "Unclear client requirements"], "first": "Create one gig with 3 sample dashboards"},
    {"id": "ai_automation", "title": "AI automation services", "skills": ["python", "ai", "llm", "rag", "api", "fastapi", "automation"],
     "what": "Chatbots, document Q&A (RAG) and workflow automation for businesses.", "cost_lkr": 5000, "hours": 10, "difficulty": 3,
     "income_usd": (200, 2500), "risks": ["Clients expect magic", "API costs if mis-priced"], "first": "Build one demo (document Q&A) and record a 2-minute video"},
    {"id": "fullstack", "title": "Web app development", "skills": ["react", "next", "javascript", "typescript", "fastapi", "full-stack", "web"],
     "what": "Build web apps and dashboards for local and online clients.", "cost_lkr": 0, "hours": 10, "difficulty": 3,
     "income_usd": (200, 2000), "risks": ["Scope creep", "Maintenance expectations"], "first": "Publish one portfolio project with a live link"},
    {"id": "tutoring", "title": "Online tutoring (Python / data)", "skills": ["python", "sql", "teaching", "data", "english"],
     "what": "1:1 lessons or small groups for students and beginners.", "cost_lkr": 0, "hours": 5, "difficulty": 2,
     "income_usd": (50, 600), "risks": ["Time-for-money only", "Finding first students"], "first": "Offer one free trial lesson to 3 people"},
    {"id": "digital_products", "title": "Digital products (templates, notebooks)", "skills": ["python", "excel", "notion", "design", "data"],
     "what": "Sell ready-made templates, notebooks or mini-courses once, many times.", "cost_lkr": 3000, "hours": 6, "difficulty": 2,
     "income_usd": (0, 500), "risks": ["Slow start without an audience"], "first": "Make one useful template and share it for free to get feedback"},
    {"id": "youtube_tech", "title": "Tech YouTube / short videos", "skills": ["video", "editing", "speaking", "ai", "data", "english"],
     "what": "Teach AI and data in short videos; build an audience over time.", "cost_lkr": 15000, "hours": 6, "difficulty": 3,
     "income_usd": (0, 300), "risks": ["Takes 6-12+ months to grow", "Consistency"], "first": "Script and post 3 short videos this week"},
    {"id": "linkedin_brand", "title": "LinkedIn personal brand", "skills": ["writing", "english", "data", "ai", "career"],
     "what": "Share what you learn and build; leads to jobs and clients.", "cost_lkr": 0, "hours": 3, "difficulty": 1,
     "income_usd": (0, 0), "risks": ["Indirect income only"], "first": "Post one lesson from your Sakuna AI project"},
    {"id": "saas", "title": "Small SaaS product", "skills": ["fastapi", "react", "next", "python", "ai", "product"],
     "what": "A focused paid tool solving one problem (your Sakuna AI is a start).", "cost_lkr": 20000, "hours": 12, "difficulty": 5,
     "income_usd": (0, 1500), "risks": ["Most small SaaS earn little", "Support and hosting costs"], "first": "Interview 5 potential users about one problem"},
    {"id": "consulting", "title": "Data / AI consulting for local businesses", "skills": ["data", "ai", "communication", "sql", "python", "business"],
     "what": "Help Sri Lankan SMEs use their data (sales, stock, reports).", "cost_lkr": 5000, "hours": 6, "difficulty": 3,
     "income_usd": (100, 1500), "risks": ["Long sales cycles", "Payment delays"], "first": "Write a one-page offer and show it to 3 business owners"},
    {"id": "video_editing", "title": "Video editing services", "skills": ["video", "editing", "design"],
     "what": "Edit short-form videos for creators and businesses.", "cost_lkr": 10000, "hours": 8, "difficulty": 2,
     "income_usd": (50, 800), "risks": ["Crowded market", "Revisions"], "first": "Edit 3 sample reels from free footage"},
    {"id": "course", "title": "Online course", "skills": ["teaching", "python", "data", "speaking", "english"],
     "what": "A structured course on a topic you know well.", "cost_lkr": 10000, "hours": 8, "difficulty": 4,
     "income_usd": (0, 1000), "risks": ["Needs an audience first"], "first": "Teach the topic live once and collect questions"},
    {"id": "cse_investing", "title": "Long-term investing (CSE / funds)", "skills": ["finance", "investing"],
     "what": "Grow savings over years; not a job, a habit.", "cost_lkr": 10000, "hours": 1, "difficulty": 2,
     "income_usd": (0, 0), "risks": ["Market losses", "Trying to get rich quickly"], "first": "Set an automatic monthly amount and keep an emergency fund first"},
    {"id": "local_service", "title": "Local tech help (setup, repairs, IT)", "skills": ["it", "networking", "computers", "support"],
     "what": "Laptop setup, networks and software help for homes and shops nearby.", "cost_lkr": 5000, "hours": 5, "difficulty": 1,
     "income_usd": (30, 300), "risks": ["Irregular demand"], "first": "Tell 10 people you know what you offer"},
    {"id": "translation", "title": "Translation / transcription (English, Sinhala, German later)", "skills": ["english", "writing", "sinhala", "german"],
     "what": "Translate or transcribe documents and videos.", "cost_lkr": 0, "hours": 5, "difficulty": 1,
     "income_usd": (30, 400), "risks": ["AI is cutting prices"], "first": "Make a profile with 2 sample translations"},
]

# competition, weeks to learn enough to sell, weeks to the first payment (typical, if you work the hours), risk class
IDEA_META = {
    "data_freelance": ("high", 8, 6, "beginner"), "ai_automation": ("medium", 12, 10, "beginner"), "fullstack": ("high", 16, 10, "beginner"),
    "tutoring": ("medium", 2, 3, "beginner"), "digital_products": ("high", 4, 12, "beginner"), "youtube_tech": ("high", 4, 40, "high_risk"),
    "linkedin_brand": ("medium", 1, 20, "beginner"), "saas": ("high", 24, 36, "high_risk"), "consulting": ("low", 8, 12, "beginner"),
    "video_editing": ("high", 8, 6, "beginner"), "course": ("medium", 12, 24, "high_risk"), "cse_investing": ("low", 4, 52, "high_risk"),
    "local_service": ("low", 2, 2, "beginner"), "translation": ("high", 1, 3, "beginner"),
}
RISK_LABEL = {"beginner": "Beginner-friendly: low cost, low downside, learn while earning", "high_risk": "Higher risk: slow or uncertain income, or money at risk"}


def _meta(idea_id: str) -> dict:
    comp, learn, first, risk = IDEA_META.get(idea_id, ("medium", 8, 12, "beginner"))
    return {"competition": comp, "learn_weeks": learn, "first_income_weeks": first, "risk": risk, "risk_label": RISK_LABEL[risk]}


def _my_skills(db: Session, user_id) -> set[str]:
    words: set[str] = set()
    cp = db.scalar(select(CareerProfile).where(CareerProfile.user_id == user_id))
    for s in (cp.skills or []) if cp else []:
        words.update(str(s).lower().replace(".js", "").split())
    for k in db.scalars(select(Skill).where(Skill.user_id == user_id)).all():
        words.update(k.name.lower().split())
    return words


def opportunities(db: Session, user_id, hours: int = 8, budget_lkr: int = 10000) -> dict:
    mine = _my_skills(db, user_id)
    out = []
    for o in OPPORTUNITIES:
        have = [s for s in o["skills"] if any(s in w or w in s for w in mine)] if mine else []
        skill_fit = len(have) / len(o["skills"])
        time_fit = 1.0 if o["hours"] <= hours else max(0.0, 1 - (o["hours"] - hours) / max(1, o["hours"]))
        money_fit = 1.0 if o["cost_lkr"] <= budget_lkr else max(0.0, 1 - (o["cost_lkr"] - budget_lkr) / max(1, o["cost_lkr"]))
        fit = round(skill_fit * 50 + time_fit * 25 + money_fit * 25)
        why = []
        if have:
            why.append(f"You already have: {', '.join(have[:4])}")
        if o["hours"] <= hours:
            why.append(f"Fits your {hours} h/week")
        if o["cost_lkr"] <= budget_lkr:
            why.append("Within your starting budget")
        lo, hi = o["income_usd"]
        out.append({**{k: o[k] for k in ("id", "title", "what", "skills", "cost_lkr", "hours", "difficulty", "risks", "first")},
                    "income": "Indirect (jobs, clients, reputation)" if hi == 0 else f"${lo}–{hi:,}/month early on (varies widely; not a promise)",
                    "fit": fit, "why": why or ["Needs new skills, but could suit you later"], "missing_skills": [s for s in o["skills"] if s not in have][:4],
                    **_meta(o["id"])})
    out.sort(key=lambda x: -x["fit"])
    active = db.scalars(select(Goal).where(Goal.user_id == user_id, Goal.status == "active")).all()
    started = [g.title for g in active if any(g.title.lower().startswith(o["title"].lower()[:12]) for o in OPPORTUNITIES)]
    return {"items": out, "hours": hours, "budget_lkr": budget_lkr, "known_skills": sorted(mine)[:30], "started": started,
            "focus_warning": "You already have 2+ income projects running. Finish or pause one before starting another." if len(started) >= 2 else None,
            "beginner": [x["id"] for x in out if x["risk"] == "beginner"], "high_risk": [x["id"] for x in out if x["risk"] == "high_risk"],
            "how": "Fit = skills you have (50) + time (25) + starting cost (25). Start one, give it 90 days, then decide. "
                   "Learning and first-income weeks are typical when you put in the listed hours; competition is how crowded the market is."}


HORIZON_FOCUS = {
    1: ["Emergency fund: 3-6 months of expenses in a savings account", "Track every expense; save on payday first",
        "Build one sellable skill and start one side income (see Income ideas)"],
    3: ["Raise your main income (promotion, job change or higher freelance rates)", "Invest a fixed amount every month in diversified funds",
        "Grow the side income to a steady monthly amount"],
    5: ["A second reliable income stream (clients, product or business)", "Keep investing; avoid lifestyle inflation when income rises",
        "Review insurance and keep debt low"],
    10: ["Let compounding work: keep contributions going through ups and downs", "Scale what works (team, product, higher-value clients)",
         "Rebalance yearly; get licensed advice for large decisions"],
}


def roadmap(current_usd: float, monthly_usd: float, rate: float, target_usd: float = 1_000_000, target_years: int = 15, scenario: str = "realistic") -> dict:
    """Checkpoints at 1, 3, 5 and 10 years: where your current saving takes you vs. the on-track path for the target."""
    sc = next(x for x in SCENARIOS if x["key"] == scenario)
    need = needed_monthly(current_usd, target_usd, target_years, sc["return_pct"], sc["saving_growth_pct"])
    mine = {p["year"]: p["value"] for p in project(current_usd, monthly_usd, sc["return_pct"], sc["saving_growth_pct"], target_usd, 10)["path"]}
    track = {p["year"]: p["value"] for p in project(current_usd, need, sc["return_pct"], sc["saving_growth_pct"], target_usd, 10)["path"]}
    steps = []
    for y in (1, 3, 5, 10):
        on_track, yours = track.get(y, 0), mine.get(y, 0)
        save_month = need * (1 + sc["saving_growth_pct"] / 100) ** (y - 1)
        steps.append({"year": y, "on_track_usd": on_track, "on_track_lkr": round(on_track * rate), "your_path_usd": yours, "your_path_lkr": round(yours * rate),
                      "gap_usd": max(0, on_track - yours), "status": "on track" if yours >= on_track * 0.97 else "behind",
                      "save_per_month_usd": round(save_month), "save_per_month_lkr": round(save_month * rate),
                      "income_per_month_usd_at_30pct": round(save_month / 0.30), "focus": HORIZON_FOCUS[y]})
    how = (f"{sc['label']} scenario: {sc['return_pct']}% yearly return, savings growing {sc['saving_growth_pct']}% a year. 'On track' is the path that "
           f"reaches USD {target_usd:,.0f} in {target_years} years. LKR uses today's rate; the rupee and prices will change. Income needed assumes you save 30%.")
    return {"scenario": sc["label"], "target_usd": target_usd, "target_years": target_years, "needed_monthly_usd": need, "needed_monthly_lkr": round(need * rate),
            "your_monthly_usd": round(monthly_usd, 2), "steps": steps, "how": how, "disclaimer": "Projections, not promises. Returns vary and can be negative."}
