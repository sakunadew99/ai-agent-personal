from dataclasses import dataclass
from datetime import date, datetime, time, timedelta


@dataclass
class SchedTask:
    id: str
    title: str
    duration_minutes: int
    priority: str


@dataclass
class SchedBlock:
    title: str
    starts_at: datetime
    ends_at: datetime
    kind: str
    task_id: str | None = None


@dataclass
class DayDraft:
    blocks: list[SchedBlock]
    conflicts: list[str]
    unscheduled: list[str]


def _span(plan_date: date, start: time, end: time, tz) -> tuple[datetime, datetime]:
    start_at = datetime.combine(plan_date, start, tzinfo=tz)
    end_at = datetime.combine(plan_date, end, tzinfo=tz)
    if end_at <= start_at:
        end_at += timedelta(days=1)
    return start_at, end_at


def _clip(start: datetime, end: datetime, window_start: datetime, window_end: datetime):
    clipped_start = max(start, window_start)
    clipped_end = min(end, window_end)
    if clipped_end <= clipped_start:
        return None
    return clipped_start, clipped_end


def _subtract(free: list[tuple[datetime, datetime]], busy: tuple[datetime, datetime]):
    busy_start, busy_end = busy
    remaining = []
    for start, end in free:
        if busy_end <= start or busy_start >= end:
            remaining.append((start, end))
            continue
        if busy_start > start:
            remaining.append((start, busy_start))
        if busy_end < end:
            remaining.append((busy_end, end))
    return [(start, end) for start, end in remaining if end > start]


def _fits(free: list[tuple[datetime, datetime]], start: datetime, end: datetime) -> bool:
    return any(gap_start <= start and end <= gap_end for gap_start, gap_end in free)


def build_day(
    plan_date: date,
    tz,
    wake: time,
    sleep: time,
    work_start: time | None,
    work_end: time | None,
    gym_time: time | None,
    tasks: list[SchedTask],
) -> DayDraft:
    window_start, window_end = _span(plan_date, wake, sleep, tz)
    free = [(window_start, window_end)]
    blocks: list[SchedBlock] = []
    conflicts: list[str] = []

    def occupy(title: str, start: datetime, end: datetime, kind: str, report: bool = True) -> None:
        nonlocal free
        if not _fits(free, start, end):
            if report:
                conflicts.append(f"{title} overlaps another block and was not scheduled")
            return
        free = _subtract(free, (start, end))
        blocks.append(SchedBlock(title, start, end, kind))

    if work_start and work_end:
        raw_start, raw_end = _span(plan_date, work_start, work_end, tz)
        clipped = _clip(raw_start, raw_end, window_start, window_end)
        if clipped is None:
            conflicts.append("Work hours fall outside the waking window")
        else:
            if clipped != (raw_start, raw_end):
                conflicts.append("Work was clipped to the waking window")
            occupy("Work", clipped[0], clipped[1], "fixed")

    if gym_time is not None:
        gym_start = datetime.combine(plan_date, gym_time, tzinfo=tz)
        gym_end = gym_start + timedelta(minutes=60)
        occupy("Gym", gym_start, gym_end, "fixed")

    anchors = [
        ("Morning routine", window_start, window_start + timedelta(minutes=30)),
        ("Breakfast", window_start + timedelta(minutes=90), window_start + timedelta(minutes=120)),
        (
            "Lunch",
            datetime.combine(plan_date, time(13, 0), tzinfo=tz),
            datetime.combine(plan_date, time(13, 45), tzinfo=tz),
        ),
        ("Dinner", window_end - timedelta(minutes=90), window_end - timedelta(minutes=45)),
    ]
    for title, start, end in anchors:
        if start < window_start or end > window_end:
            continue
        occupy(title, start, end, "fixed", report=False)

    rank = {"high": 0, "medium": 1, "low": 2}
    ordered = sorted(tasks, key=lambda task: (rank.get(task.priority, 1), task.title))
    unscheduled = []
    for task in ordered:
        duration = timedelta(minutes=max(task.duration_minutes or 30, 5))
        placed = None
        for start, end in free:
            if end - start >= duration:
                placed = (start, start + duration)
                break
        if placed is None:
            unscheduled.append(task.title)
            continue
        free = _subtract(free, placed)
        blocks.append(SchedBlock(task.title, placed[0], placed[1], "task", task.id))

    blocks.sort(key=lambda block: block.starts_at)
    return DayDraft(blocks, conflicts, unscheduled)
