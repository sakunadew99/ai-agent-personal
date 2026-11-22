"""English grammar & style check for conversation practice.

Offline rules always run (plain code, no key). If you tap "deeper check", the text (only that text) is sent to the
free public LanguageTool API (api.languagetool.org); its suggestions are merged in. Results are suggestions, never
automatic rewrites of anything you send to others.
"""
from __future__ import annotations

import re

import httpx

LT_URL = "https://api.languagetool.org/v2/check"
VOWEL_SOUND_EXCEPTIONS = ("uni", "use", "user", "usu", "euro", "one", "once")       # "a university", "a one-day"
SILENT_H = ("hour", "honest", "honour", "honor", "heir")                            # "an hour"
COMMON = [
    (r"\b(i)\b", "I", "Write 'I' with a capital letter."),
    (r"\bcould of\b", "could have", "Use 'could have', not 'could of'."),
    (r"\bshould of\b", "should have", "Use 'should have', not 'should of'."),
    (r"\bwould of\b", "would have", "Use 'would have', not 'would of'."),
    (r"\bmore better\b", "better", "'Better' already means 'more good'."),
    (r"\bdiscuss about\b", "discuss", "'Discuss' doesn't take 'about'."),
    (r"\bexplain me\b", "explain to me", "Say 'explain to me'."),
    (r"\bcope up with\b", "cope with", "Say 'cope with' ('cope up' is not standard)."),
    (r"\bdo the needful\b", "do what is needed", "'Do the needful' sounds old-fashioned outside South Asia."),
    (r"\brevert back\b", "reply", "'Revert' means 'go back'; to answer an email, say 'reply'."),
    (r"\bpass out\b(?= (from|of) (school|university|college))", "graduate", "Internationally, 'pass out' means 'faint'; say 'graduate'."),
    (r"\bprepone\b", "bring forward", "'Prepone' isn't understood outside South Asia; say 'bring forward'."),
    (r"\b(he|she|it) don't\b", None, "Use 'doesn't' with he/she/it."),
    (r"\b(he|she|it) have\b", None, "Use 'has' with he/she/it."),
    (r"\bdidn't (went|saw|came|did|ate|took|gave|wrote)\b", None, "After 'didn't', use the base verb (e.g. 'didn't go')."),
    (r"\bsince (\d+ (years|months|days|weeks))\b", None, "Use 'for' with a length of time ('for 3 years'); 'since' takes a start point ('since 2020')."),
]
BASE = {"he don't": "he doesn't", "she don't": "she doesn't", "it don't": "it doesn't", "he have": "he has", "she have": "she has", "it have": "it has"}
PAST_TO_BASE = {"went": "go", "saw": "see", "came": "come", "did": "do", "ate": "eat", "took": "take", "gave": "give", "wrote": "write"}


def _issue(start: int, end: int, text: str, message: str, fix: str | None, source: str = "rules") -> dict:
    return {"offset": start, "length": end - start, "text": text[start:end], "message": message, "suggestion": fix, "source": source}


def offline(text: str) -> list[dict]:
    out: list[dict] = []
    for pat, fix, why in COMMON:
        for m in re.finditer(pat, text, flags=0 if pat == r"\b(i)\b" else re.IGNORECASE):
            found = m.group(0)
            sug = fix
            low = found.lower()
            if sug is None:
                if low in BASE:
                    sug = BASE[low]
                elif low.startswith("didn't "):
                    sug = "didn't " + PAST_TO_BASE.get(low.split()[1], low.split()[1])
                elif low.startswith("since "):
                    sug = "for " + found[6:]
            out.append(_issue(m.start(), m.end(), text, why, sug))
    for m in re.finditer(r"\b(a|an) ([A-Za-z]+)", text, flags=re.IGNORECASE):
        art, word = m.group(1).lower(), m.group(2).lower()
        vowel = word[0] in "aeiou" and not word.startswith(VOWEL_SOUND_EXCEPTIONS)
        vowel = vowel or word.startswith(SILENT_H)
        if art == "a" and vowel:
            out.append(_issue(m.start(1), m.end(1), text, f"Use 'an' before a vowel sound ('an {word}').", "an"))
        elif art == "an" and not vowel:
            out.append(_issue(m.start(1), m.end(1), text, f"Use 'a' before a consonant sound ('a {word}').", "a"))
    for m in re.finditer(r"\b(\w+) \1\b", text, flags=re.IGNORECASE):
        if m.group(1).lower() not in ("that", "had"):
            out.append(_issue(m.start(), m.end(), text, "Repeated word.", m.group(1)))
    for m in re.finditer(r"(?:^|[.!?]\s+)([a-z])", text):
        out.append(_issue(m.start(1), m.end(1), text, "Start a sentence with a capital letter.", m.group(1).upper()))
    for m in re.finditer(r" {2,}", text):
        out.append(_issue(m.start(), m.end(), text, "Extra spaces.", " "))
    for m in re.finditer(r" ([,.!?;:])", text):
        out.append(_issue(m.start(), m.end(), text, "No space before punctuation.", m.group(1)))
    if text.strip() and len(text.split()) >= 4 and text.strip()[-1] not in ".!?\"')":
        end = len(text.rstrip())
        out.append(_issue(end, end, text, "End the sentence with a full stop or question mark.", "."))
    return out


def _http(text: str, lang: str) -> dict:
    r = httpx.post(LT_URL, data={"text": text, "language": lang}, timeout=15)
    r.raise_for_status()
    return r.json()


def online(text: str, lang: str = "en-GB") -> list[dict]:
    data = _http(text, lang)
    out = []
    for m in data.get("matches", [])[:40]:
        reps = [r.get("value") for r in (m.get("replacements") or [])[:3] if r.get("value") is not None]
        off, ln = int(m.get("offset", 0)), int(m.get("length", 0))
        out.append({"offset": off, "length": ln, "text": text[off:off + ln], "message": str(m.get("message", ""))[:300],
                    "suggestion": reps[0] if reps else None, "alternatives": reps[1:], "source": "languagetool",
                    "category": ((m.get("rule") or {}).get("category") or {}).get("name")})
    return out


def apply(text: str, issues: list[dict]) -> str:
    """Corrected version: apply non-overlapping suggestions from the end so offsets stay valid."""
    chosen, last = [], None
    for i in sorted((i for i in issues if i.get("suggestion") is not None), key=lambda i: (i["offset"], -i["length"])):
        if last is not None and i["offset"] < last:
            continue
        chosen.append(i); last = i["offset"] + i["length"]
    for i in reversed(chosen):
        text = text[:i["offset"]] + i["suggestion"] + text[i["offset"] + i["length"]:]
    return text


def check(text: str, deep: bool = False, lang: str = "en-GB") -> dict:
    issues = offline(text)
    note = None
    if deep:
        try:
            seen = {(i["offset"], i["length"]) for i in issues}
            issues += [i for i in online(text, lang) if (i["offset"], i["length"]) not in seen]
        except Exception:                                    # offline or rate-limited: rules still work
            note = "The deeper check (LanguageTool) isn't reachable right now; showing the built-in checks."
    issues.sort(key=lambda i: i["offset"])
    words = len(text.split())
    score = max(0, 100 - round(len(issues) / max(words, 1) * 100 * 3))
    return {"issues": issues, "corrected": apply(text, issues), "count": len(issues), "words": words, "score": score, "deep": deep, "note": note,
            "privacy": "Built-in checks run on the server only. The deeper check sends just this text to LanguageTool (api.languagetool.org)."}
