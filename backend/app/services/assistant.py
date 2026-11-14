import json
import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now_utc
from app.core.config import settings
from app.models.entities import Conversation, Goal, Message, Task, User
from app.schemas.dto import ActionRef
from app.services.actions import combine_local, create_daily_plan, queue_or_run
from app.services.ai_client import chat_complete, model_for
from app.services.capture import parse_capture
from app.services.finance_query import finance_summary
from app.services.insights import insight_facts
from app.services.memory import search_memories


def classify_intent(text: str) -> str:
    lowered = text.lower().strip()
    if lowered.startswith("remember"):
        return "remember"
    if any(word in lowered for word in ("spent", "paid ", "expense", "bought")):
        return "expense"
    if any(phrase in lowered for phrase in ("plan tomorrow", "organize tomorrow", "plan my day", "help me organize")):
        return "plan"
    if any(phrase in lowered for phrase in (
        "design a task", "design this task", "break this down", "break it down",
        "break down this", "task breakdown", "turn this into tasks", "scope this project",
    )) or ("task" in lowered and "step" in lowered):
        return "task_design"
    if any(word in lowered for word in ("net worth", "savings", "income", "spent this", "how much money", "money")):
        return "finance"
    if any(word in lowered for word in ("productiv", "habit")):
        return "productivity"
    if re.search(r"\b(i need to|add a task|create a task|remind me to)\b", lowered):
        return "capture"
    if any(word in lowered for word in ("learn next", "what should i learn", "study next")):
        return "learning"
    if "goal" in lowered or "progress" in lowered:
        return "goals"
    if any(word in lowered for word in ("focus", "important task", "today")):
        return "focus"
    return "general"


def converse(db: Session, user: User, message: str, conversation_id):
    conversation = _conversation(db, user, conversation_id, message)
    intent = classify_intent(message)
    proposed, completed, refused = _act(db, user, intent, message)
    memories = _relevant_memories(db, user, message)
    facts = _facts(db, user, intent, memories)
    draft = _draft(facts, proposed, completed, refused)
    reply = _phrase(db, user, conversation, message, draft, intent)
    db.add(Message(conversation_id=conversation.id, user_id=user.id, role="user", content=message, actions={}))
    db.add(
        Message(
            conversation_id=conversation.id,
            user_id=user.id,
            role="assistant",
            content=reply,
            actions={
                "proposed": [item.model_dump(mode="json") for item in proposed],
                "completed": [item.model_dump(mode="json") for item in completed],
            },
        )
    )
    conversation.updated_at = now_utc()
    _maybe_summarize(db, user, conversation)
    db.commit()
    return {
        "conversation_id": conversation.id,
        "reply": reply,
        "actions_proposed": proposed,
        "actions_completed": completed,
        "relevant_memories": [f"{item.category}: {item.content}" for item in memories],
    }


def _conversation(db: Session, user: User, conversation_id, message: str) -> Conversation:
    if conversation_id is not None:
        row = db.get(Conversation, conversation_id)
        if row is None or row.user_id != user.id:
            from fastapi import HTTPException

            raise HTTPException(404, "Conversation not found")
        return row
    title = message.strip().splitlines()[0][:80]
    row = Conversation(user_id=user.id, title=title or "New conversation")
    db.add(row)
    db.flush()
    return row


def _act(db: Session, user: User, intent: str, message: str):
    proposed: list[ActionRef] = []
    completed: list[ActionRef] = []
    refused: list[ActionRef] = []
    if intent == "remember":
        content = re.sub(r"^remember( that)?\s*", "", message.strip(), flags=re.IGNORECASE)
        outcome = queue_or_run(db, user, "save_memory", {"content": content, "category": "note"}, f"Save memory: {content[:80]}")
        _collect(outcome, proposed, completed, refused)
    elif intent == "capture":
        from app.services.actions import _today

        parsed = parse_capture(message, _today(db, user.id))
        if parsed["classified_type"] == "note":
            outcome = queue_or_run(db, user, "save_memory", {"content": message, "category": "note"}, "Save note")
        elif parsed["ambiguous"]:
            outcome = queue_or_run(
                db,
                user,
                "create_task",
                {"title": parsed["title"], "category": parsed["category"], "duration_minutes": parsed["duration_minutes"] or 30},
                f"Create task '{parsed['title']}' (date was unclear)",
            )
        else:
            due = None
            if parsed["date"]:
                from datetime import date

                due = combine_local(db, user.id, date.fromisoformat(parsed["date"]), parsed["suggested_time"])
            outcome = queue_or_run(
                db,
                user,
                "create_task",
                {
                    "title": parsed["title"],
                    "category": parsed["category"],
                    "duration_minutes": parsed["duration_minutes"] or 30,
                    "due_at": due.isoformat() if due else None,
                    "notes": message,
                },
                f"Create task '{parsed['title']}'",
            )
        _collect(outcome, proposed, completed, refused)
    elif intent == "expense":
        from app.services.actions import _today

        parsed = parse_capture(message, _today(db, user.id))
        if parsed["amount"] is None:
            refused.append(ActionRef(tool="create_expense", status="refused", summary="No amount was found, so nothing was recorded"))
        else:
            body = {
                "amount": parsed["amount"],
                "currency": (parsed["currency"] or "USD").upper(),
                "category": parsed["category"] if parsed["category"] in {
                    "food", "transport", "housing", "subscriptions", "shopping", "health", "education", "business", "savings", "other"
                } else "other",
                "spent_at": combine_local(db, user.id, __import__("datetime").date.fromisoformat(parsed["date"]), "12:00").isoformat(),
                "notes": message,
            }
            outcome = queue_or_run(db, user, "create_expense", body, f"Record {body['currency']} {body['amount']} {body['category']} expense")
            _collect(outcome, proposed, completed, refused)
    elif intent == "plan":
        from app.services.actions import _today

        target = _today(db, user.id) + timedelta(days=1 if "tomorrow" in message.lower() else 0)
        outcome = queue_or_run(db, user, "create_daily_plan", {"plan_date": target.isoformat()}, f"Build the plan for {target.isoformat()}")
        _collect(outcome, proposed, completed, refused)
        if outcome["status"] == "completed":
            create_daily_plan  # already executed inside queue_or_run
    return proposed, completed, refused


def _collect(outcome: dict, proposed, completed, refused) -> None:
    ref = ActionRef(
        tool=outcome["tool"],
        status=outcome["status"],
        summary=outcome["summary"],
        approval_id=outcome.get("approval_id"),
        resource_id=outcome.get("resource_id"),
    )
    if outcome["status"] == "completed":
        completed.append(ref)
    elif outcome["status"] == "proposed":
        proposed.append(ref)
    else:
        refused.append(ref)


def _relevant_memories(db: Session, user: User, message: str, limit: int = 4):
    """Fetch only this user's relevant, non-sensitive memories for the current turn."""
    try:
        rows = search_memories(db, user.id, message[:500], limit=12)
    except Exception:
        # Chat should remain available if optional vector search is unavailable.
        return []
    rows = [item for item in rows if item.sensitivity != "sensitive" and item.deleted_at is None]
    query_terms = {
        term for term in re.findall(r"[a-z0-9]{3,}", message.lower())
        if term not in {"what", "when", "where", "which", "with", "this", "that", "have", "about", "help", "please", "could", "would", "should", "from", "your", "does"}
    }
    if not query_terms and not settings.openai_api_key:
        return []
    if query_terms and not settings.openai_api_key:
        rows.sort(key=lambda item: (
            sum(term in item.content.lower() for term in query_terms),
            bool(item.pinned),
            item.updated_at,
        ), reverse=True)
        rows = [item for item in rows if any(term in item.content.lower() for term in query_terms)]
    return rows[:limit]


def _facts(db: Session, user: User, intent: str, memories=None) -> str:
    tasks = db.scalars(select(Task).where(Task.user_id == user.id, Task.status.in_(["todo", "in_progress", "inbox"]))).all()
    goals = db.scalars(select(Goal).where(Goal.user_id == user.id, Goal.status == "active")).all()
    lines = [
        f"Open tasks: {len(tasks)}.",
        "Highest priority: " + ", ".join(task.title for task in tasks if task.priority == "high")[:240] or "none.",
        "Active goals: " + ", ".join(goal.title for goal in goals)[:240] or "none.",
    ]
    if intent in {"finance", "general", "goals"}:
        summary = finance_summary(db, user, None)
        lines.append(
            f"This month actual net income is {summary['net_income']} {summary['currency']}. "
            f"Net worth is {summary['net_worth']} {summary['currency']}."
        )
        if summary["target_amount"] is not None:
            lines.append(
                f"Financial target tracking: {summary['net_worth']} of {summary['target_amount']} "
                f"({summary['target_progress_percent']}%). This is recorded progress, not a forecast."
            )
    if intent in {"productivity", "learning", "focus", "general"}:
        lines.append(_activity_fact_line(db, user))
    if intent == "task_design":
        lines.append("Task design request: provide an actionable breakdown; do not create tasks unless the user explicitly asks to add or create them.")
    if memories:
        lines.append("Relevant saved memories (user-approved, non-sensitive): " + " | ".join(
            f"[{item.category}] {item.content[:300]}" for item in memories
        ))
    return "\n".join(lines)


def _activity_fact_line(db: Session, user: User) -> str:
    return "Recent activity: " + json.dumps(insight_facts(db, user), ensure_ascii=False)


def _draft(facts: str, proposed, completed, refused) -> str:
    parts = []
    if completed:
        parts.append("Completed now:\n" + "\n".join(f"- {item.summary}" for item in completed))
    if proposed:
        parts.append("Proposed only. Nothing below has been done until you approve it:\n" + "\n".join(f"- {item.summary}" for item in proposed))
    if refused:
        parts.append("Not done:\n" + "\n".join(f"- {item.summary}" for item in refused))
    parts.append(facts)
    parts.append("Suggestions above are not completed actions unless they are listed under Completed now.")
    return "\n\n".join(parts)


def _phrase(db, user, conversation, message, draft, intent) -> str:
    if not settings.openai_api_key:
        return _local_reply(message, draft, intent)
    history = db.scalars(
        select(Message).where(Message.conversation_id == conversation.id).order_by(Message.created_at.desc()).limit(12)
    ).all()
    messages = [
        {
            "role": "system",
            "content": (
                "You are Sakuna, a personal life assistant. Use only the facts provided. "
                "Use relevant saved memories when they help, and say when a recommendation is based on one. "
                "For task design, give a concise outcome, ordered steps, and a suggested first step. "
                "Do not create, schedule, spend, or change data unless the user clearly asked for that action. "
                "Never claim an action happened unless it is listed as completed. "
                "Call proposed items proposals. Do not give medical or guaranteed financial advice."
            ),
        }
    ]
    if conversation.summary:
        messages.append({"role": "system", "content": f"Earlier context: {conversation.summary}"})
    for item in reversed(history):
        if item.role in {"user", "assistant"}:
            messages.append({"role": item.role, "content": item.content})
    messages.append({"role": "user", "content": message})
    messages.append({"role": "system", "content": f"Facts and action log:\n{draft}"})
    phrased = chat_complete(db, user.id, intent, model_for("analysis" if intent in {"finance", "productivity"} else "conversation"), messages)
    return phrased or draft


def _local_reply(message: str, draft: str, intent: str) -> str:
    """Give a useful, readable answer when no hosted language model is configured."""
    text = message.strip().lower()
    memory_line = next((line for line in draft.splitlines() if line.startswith("Relevant saved memories")), "")
    memory_note = " I also considered the relevant saved context shown below." if memory_line else ""
    if re.fullmatch(r"(?:hi|hello|hey|good morning|good afternoon|good evening)[!. ]*", text):
        return "Hi! I’m Sakuna. I can help you decide what to focus on, review your goals, or plan your day. What would you like to work on?"

    facts = [line.strip() for line in draft.splitlines() if line.strip()]
    facts = [line for line in facts if not line.startswith(("Recent activity:", "Suggestions above"))]
    if intent == "focus":
        tasks = next((line for line in facts if line.startswith("Open tasks:")), "")
        priorities = next((line for line in facts if line.startswith("Highest priority:")), "" )
        if priorities.endswith("none.") or priorities.endswith("none"):
            return f"{tasks} I don’t see a high priority task recorded yet. Choose the most important open task and give it a focused 25 minute session.{memory_note}"
        priority_names = priorities.removeprefix("Highest priority:").strip().rstrip(".")
        return f"Start with {priority_names}. {tasks} Set aside a focused 25 minute session, then choose the next task.{memory_note}"
    if intent == "goals":
        goals = next((line for line in facts if line.startswith("Active goals:")), "Active goals: none.")
        if goals.endswith("none.") or goals.endswith("none"):
            return "You don’t have an active goal recorded yet. Add one in My life, and I can help you break it into smaller steps." + memory_note
        return f"Here’s what I can see: {goals} If you tell me which goal you mean, I can help you choose a next step.{memory_note}"
    if intent == "finance":
        finance = next((line for line in facts if line.startswith("This month actual net income")), "")
        return f"{finance} These are the financial records saved in Sakuna. Add or update records in Finance if the numbers look incomplete.{memory_note}"
    if intent == "plan":
        if "Proposed only." in draft:
            return "I’ve prepared the plan request. It’s waiting for your approval before Sakuna creates it; open Approvals to review it."
        if "Completed now:" in draft:
            return "Your plan has been created. Open Planner to review the scheduled blocks."
        return "I couldn’t create the plan from this request. Check Planner and try again."
    if intent in {"capture", "remember", "expense"}:
        if "Proposed only." in draft:
            return "I’ve prepared that request, but it’s waiting for your approval. Open Approvals to review it."
        if "Completed now:" in draft:
            return "Done. " + next((line.removeprefix("- ") for line in draft.splitlines() if line.startswith("- ")), "I saved the requested item.")
        if "Not done:" in draft:
            return "I couldn’t complete that request. Please add the missing details and try again."
        return "Tell me what you’d like me to save or add, and I’ll help with it."
    if intent == "productivity":
        activity = next((line for line in draft.splitlines() if line.startswith("Recent activity:")), "")
        return "I can review your recent activity and suggest a next step. " + (activity if activity else "Log a task or habit first so I have recent activity to review.")
    if intent == "task_design":
        target = re.sub(
            r"^(?:please\s+)?(?:break (?:a task|this|it) (?:down(?: into steps)?|into steps)|break down this|"
            r"design (?:a task|this task)|scope this project)(?:\s+(?:for|about))?\s*",
            "",
            message.strip(),
            flags=re.IGNORECASE,
        ).strip(" :.-")
        if any(term in target.lower() for term in ("website", "portfolio", "web app", "mobile app")):
            subject = target or "your website"
            return (
                f"Let’s plan {subject}: 1) Define the audience, goal, pages, and deadline. "
                "2) Gather the content and examples you want to show. 3) Build the first responsive version. "
                "4) Check it on phone and desktop, fix links and accessibility, then publish it. "
                "Start by outlining the pages and choosing the three strongest examples to include. "
                "Tell me your deadline and preferred tools and I can shape this into a schedule. "
                "I haven’t created any tasks."
            )
        opening = f"For {target}," if target else "Here’s a practical task design:"
        return (
            f"{opening} first define the finished result and any deadline. Then split the work into: "
            "1) gather what you need, 2) complete the smallest useful draft or first version, "
            "3) review it against the result, and 4) finish and share it. Start with a 25 minute block "
            "for step 1. These are suggestions; I haven’t added tasks. Tell me the task and deadline "
            "if you want a tailored breakdown." + memory_note
        )
    return "I can help with your tasks, goals, daily plans, habits, and saved financial records. Try asking what to focus on, how a goal is going, or to plan tomorrow." + memory_note


def _maybe_summarize(db, user, conversation: Conversation) -> None:
    count = len(db.scalars(select(Message.id).where(Message.conversation_id == conversation.id)).all())
    if count < 24 or count % 12 != 0:
        return
    older = db.scalars(
        select(Message).where(Message.conversation_id == conversation.id).order_by(Message.created_at.asc()).limit(12)
    ).all()
    extract = " | ".join(item.content[:120] for item in older)
    summary = extract[:800]
    if settings.openai_api_key:
        generated = chat_complete(
            db,
            user.id,
            "summary",
            model_for("classification"),
            [
                {"role": "system", "content": "Summarize this personal conversation in under 120 words. Omit secrets."},
                {"role": "user", "content": extract},
            ],
        )
        if generated:
            summary = generated
    conversation.summary = summary
