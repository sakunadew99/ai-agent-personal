"""Study-abroad planner (guide 39): programs, a checklist counted backward from the deadline, costs, scholarships.

Rules: no guarantees of admission or visas; Sakuna never submits applications, fills forms, pays fees or contacts
universities. Deadlines, fees, scores and visa rules change: every program shows "last verified" and asks you to
re-check on the official page before relying on it. Money is exact decimals; LKR conversion uses YOUR rate and date.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import ProgramRequirement, Scholarship, StudyCost, StudyProgram, Task, UserProfile
from app.services.audit import audit

CENT = Decimal("0.01")
VERIFY_EVERY_DAYS = 30
ACTIVE_STAGES = ("shortlist", "requirements", "prepare", "apply", "offer", "visa")

# kind: (title, days before the deadline it should be done). Slow steps get bigger buffers (guide 39.3).
CHECKLIST: list[tuple[str, str, int]] = [
    ("passport", "Check passport is valid for the whole stay (renew if needed)", 90),
    ("language_test", "Book and take the language test", 60),
    ("transcripts", "Get certified transcripts and degree certificate (and translations if required)", 45),
    ("references", "Ask referees for recommendation letters", 40),
    ("sop", "Write the statement of purpose", 21),
    ("cv", "Update your CV for this program", 21),
    ("funds", "Prepare proof of funds (check the current official rule)", 14),
    ("fee", "Pay the application fee yourself on the official site", 3),
    ("submit", "Submit the application (you submit; Sakuna never does)", 2),
]
COST_ITEMS = ("application_fee", "test_fee", "translation", "travel", "visa_fee", "deposit", "first_month", "tuition", "living",
              "insurance", "other")


def q(v) -> Decimal:
    return Decimal(str(v)).quantize(CENT, rounding=ROUND_HALF_UP)


def _tz(db: Session, user_id):
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(profile.timezone if profile else None)


def needs_verify(row, today: date) -> bool:
    if row.last_verified_at is None:
        return True
    return (today - as_utc(row.last_verified_at).date()).days > VERIFY_EVERY_DAYS


def build_checklist(db: Session, program: StudyProgram, create_tasks: bool, portfolio: bool = False) -> list[ProgramRequirement]:
    """Requirement items with due dates counted back from the deadline. Existing kinds are kept (idempotent)."""
    if program.deadline is None:
        raise HTTPException(422, "Add the application deadline first; the checklist counts back from it.")
    tz = _tz(db, program.user_id)
    today = datetime.now(tz).date()
    existing = {r.kind: r for r in db.scalars(select(ProgramRequirement).where(ProgramRequirement.program_id == program.id)).all()}
    items = list(CHECKLIST)
    if portfolio:
        items.insert(5, ("portfolio", "Prepare portfolio / work samples", 28))
    if not program.language_test:
        items = [i for i in items if i[0] != "language_test"]
    created = []
    for kind, title, days_before in items:
        if kind in existing:
            continue
        due = max(today, program.deadline - timedelta(days=days_before))
        req = ProgramRequirement(user_id=program.user_id, program_id=program.id, kind=kind, due_date=due,
                                 title=f"{title} · {program.university}" if kind != "language_test" else f"{title} ({program.language_test}) · {program.university}")
        db.add(req)
        created.append(req)
    db.flush()
    if create_tasks:
        from app.schemas.dto import TaskIn
        from app.services.actions import create_task
        for req in created:
            task = create_task(db, program.user_id, TaskIn(title=req.title[:200], category="learning", priority="high" if req.kind in ("submit", "fee") else "medium",
                                                           due_at=datetime.combine(req.due_date, time(9), tzinfo=tz), duration_minutes=60,
                                                           notes="Study-abroad checklist. Verify the requirement on the official page."))
            req.task_id = task.id
    audit(db, program.user_id, "study.checklist", "study_program", program.id, {"items": len(created), "tasks": create_tasks})
    return list(db.scalars(select(ProgramRequirement).where(ProgramRequirement.program_id == program.id).order_by(ProgramRequirement.due_date)).all())


def cost_plan(db: Session, program: StudyProgram) -> dict:
    """First-year cost in the program currency, other currencies kept separate; LKR only with your own rate."""
    items = db.scalars(select(StudyCost).where(StudyCost.program_id == program.id).order_by(StudyCost.created_at)).all()
    lines = [{"item": "application_fee", "amount": q(program.application_fee), "currency": program.currency, "source": "program"}] if program.application_fee else []
    if program.tuition_per_year:
        lines.append({"item": "tuition", "amount": q(program.tuition_per_year), "currency": program.currency, "source": "program (1 year)"})
    if program.living_per_month:
        lines.append({"item": "living", "amount": q(program.living_per_month * 12), "currency": program.currency, "source": "program (12 months)"})
    lines += [{"id": c.id, "item": c.item, "amount": q(c.amount), "currency": c.currency, "note": c.note, "source": "you"} for c in items]
    totals: dict[str, Decimal] = {}
    for line in lines:
        totals[line["currency"]] = q(totals.get(line["currency"], Decimal("0")) + line["amount"])
    lkr = None
    if program.fx_rate_to_lkr:
        lkr = q(totals.get(program.currency, Decimal("0")) * program.fx_rate_to_lkr) + totals.get("LKR", Decimal("0"))
    other = {c: v for c, v in totals.items() if c not in (program.currency, "LKR")}
    return {"program_id": program.id, "currency": program.currency, "lines": lines, "totals": totals,
            "first_year_total": totals.get(program.currency, Decimal("0")), "lkr_total": lkr,
            "fx": {"rate": program.fx_rate_to_lkr, "date": program.fx_rate_date} if program.fx_rate_to_lkr else None,
            "not_converted": other,
            "note": "Estimates you entered. Proof-of-funds rules for visas differ by country and change; check the official page."}


def overview(db: Session, user_id) -> dict:
    tz = _tz(db, user_id)
    today = datetime.now(tz).date()
    programs = db.scalars(select(StudyProgram).where(StudyProgram.user_id == user_id).order_by(StudyProgram.deadline.asc().nullslast())).all()
    scholarships = db.scalars(select(Scholarship).where(Scholarship.user_id == user_id)).all()
    reqs = db.scalars(select(ProgramRequirement).where(ProgramRequirement.user_id == user_id, ProgramRequirement.status == "todo")
                      .order_by(ProgramRequirement.due_date.asc().nullslast())).all()
    by_stage: dict[str, int] = {}
    for p in programs:
        by_stage[p.stage] = by_stage.get(p.stage, 0) + 1
    names = {p.id: f"{p.university} · {p.course}" for p in programs}
    horizon = today + timedelta(days=60)
    deadlines = [{"kind": "program", "id": p.id, "title": names[p.id], "date": p.deadline, "days_left": (p.deadline - today).days,
                  "verify": needs_verify(p, today)} for p in programs if p.deadline and today <= p.deadline <= horizon and p.stage != "dropped"]
    deadlines += [{"kind": "scholarship", "id": s.id, "title": s.name, "date": s.deadline, "days_left": (s.deadline - today).days,
                   "verify": needs_verify(s, today)} for s in scholarships
                  if s.deadline and today <= s.deadline <= horizon and s.status in ("researching", "preparing")]
    deadlines.sort(key=lambda d: d["date"])
    lkr_totals = [cost_plan(db, p)["lkr_total"] for p in programs if p.stage in ACTIVE_STAGES and p.fx_rate_to_lkr]
    lkr_totals = [t for t in lkr_totals if t is not None]
    return {
        "by_stage": by_stage, "programs": len(programs),
        "next_actions": [{"id": r.id, "program": names.get(r.program_id, ""), "title": r.title, "due_date": r.due_date,
                          "overdue": bool(r.due_date and r.due_date < today)} for r in reqs[:3]],
        "deadlines_60_days": deadlines,
        "to_verify": [{"kind": "program", "id": p.id, "title": names[p.id]} for p in programs
                      if p.stage in ACTIVE_STAGES and needs_verify(p, today)][:5],
        "money": {"active_programs_with_rate": len(lkr_totals), "first_year_lkr_max": max(lkr_totals, default=None),
                  "note": "Largest first-year estimate among your active programs (you'll attend one)."},
        "disclaimer": "Sakuna organises your plan. It never guarantees admission or visas, and never submits, pays or contacts anyone for you.",
    }


def create_fund_goal(db: Session, program: StudyProgram):
    from app.schemas.dto import GoalIn
    from app.services.actions import create_goal
    plan = cost_plan(db, program)
    if plan["lkr_total"] is not None:
        target, currency = plan["lkr_total"], "LKR"
    else:
        target, currency = plan["first_year_total"], program.currency
    if not target:
        raise HTTPException(422, "Add costs (tuition, living, fees) first.")
    goal = create_goal(db, program.user_id, GoalIn(title=f"Study fund: {program.university}"[:200], category="finance", target_value=target,
                                                   unit=currency, due_date=program.deadline, metric="savings_balance", metric_currency=currency))
    return goal


def touch(row) -> None:
    row.updated_at = now_utc()


def mark_verified(row) -> None:
    row.last_verified_at = row.updated_at = now_utc()


def requirement_done(db: Session, req: ProgramRequirement, done: bool) -> None:
    req.status = "done" if done else "todo"
    req.updated_at = now_utc()
    if req.task_id:
        task = db.get(Task, req.task_id)
        if task is not None and task.user_id == req.user_id and done and task.status != "done":
            from app.services.actions import complete_task
            complete_task(db, task)
