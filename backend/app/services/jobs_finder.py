"""Find jobs from free public job feeds (Arbeitnow, Remotive, Remote OK, Jobicy) and link out to LinkedIn and others.

LinkedIn, Indeed, Glassdoor, XING and StepStone don't allow scraping, so Sakuna builds search links for them instead.
Feeds are read at most once per 12 hours per query (cached) and every job links back to its source, as their terms ask.
Job text is untrusted data: it is shown and counted, never followed as instructions.
"""
from __future__ import annotations

import html
import json
import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import quote_plus

import httpx

USER_AGENT = "Mozilla/5.0 (Sakuna personal job finder; one user, cached)"
TTL = 12 * 3600
_cache: dict[str, tuple[float, object]] = {}


def _fetch(url: str) -> str:
    """One GET (tests replace this)."""
    with httpx.Client(timeout=25, follow_redirects=True, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.text


def clear_cache() -> None:
    _cache.clear()


def _cached(key: str, compute):
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    value = compute()
    if len(_cache) > 200:
        _cache.clear()
    _cache[key] = (time.time() + TTL, value)
    return value


def _text(raw, limit=600) -> str:
    s = html.unescape(html.unescape(str(raw or "")))
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()[:limit]


def _date(value) -> str | None:
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc).date().isoformat()
        if value:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date().isoformat()
    except (ValueError, OSError):
        return None
    return None


def _job(source, jid, title, company, location, remote, tags, url, posted, description, salary=None) -> dict:
    return {"id": f"{source}:{jid}", "source": source, "title": _text(title, 200), "company": _text(company, 120) or "—",
            "location": _text(location, 120) or ("Remote" if remote else "—"), "remote": bool(remote),
            "tags": [_text(t, 40).lower() for t in (tags or []) if t][:12], "url": str(url or "")[:500], "posted": _date(posted),
            "salary": _text(salary, 80) or None, "snippet": _text(description, 400)}


def _arbeitnow(_q: str) -> list[dict]:
    out = []
    for page in (1, 2, 3):
        data = json.loads(_fetch(f"https://www.arbeitnow.com/api/job-board-api?page={page}"))
        for j in data.get("data", []):
            out.append(_job("Arbeitnow", j.get("slug"), j.get("title"), j.get("company_name"), j.get("location"), j.get("remote"),
                            j.get("tags", []) + j.get("job_types", []), j.get("url"), j.get("created_at"), j.get("description")))
    return out


def _remotive(q: str) -> list[dict]:
    data = json.loads(_fetch(f"https://remotive.com/api/remote-jobs?search={quote_plus(q)}&limit=60"))
    return [_job("Remotive", j.get("id"), j.get("title"), j.get("company_name"), j.get("candidate_required_location"), True,
                 j.get("tags", []) + [j.get("category", "")], j.get("url"), j.get("publication_date"), j.get("description"), j.get("salary"))
            for j in data.get("jobs", [])]


def _remoteok(q: str) -> list[dict]:
    tag = re.sub(r"[^a-z0-9]+", "-", q.lower()).strip("-").split("-")[0] or "dev"
    data = json.loads(_fetch(f"https://remoteok.com/api?tag={quote_plus(tag)}"))
    out = []
    for j in data[1:] if isinstance(data, list) else []:
        sal = f"${j['salary_min']:,}-{j['salary_max']:,}" if j.get("salary_min") and j.get("salary_max") else None
        out.append(_job("Remote OK", j.get("id"), j.get("position"), j.get("company"), j.get("location"), True, j.get("tags", []), j.get("url"),
                        j.get("epoch") or j.get("date"), j.get("description"), sal))
    return out


def _jobicy(q: str) -> list[dict]:
    words = [w for w in re.findall(r"[a-z0-9]+", q.lower()) if w not in ("developer", "engineer", "and")][:2] or ["developer"]
    rows = []
    for w in words:
        rows += json.loads(_fetch(f"https://jobicy.com/api/v2/remote-jobs?count=50&tag={quote_plus(w)}")).get("jobs", [])
    out = []
    for j in rows:
        sal = f"{j.get('salaryCurrency', '')} {j['annualSalaryMin']:,}-{j['annualSalaryMax']:,}" if j.get("annualSalaryMin") and j.get("annualSalaryMax") else None
        industry = j.get("jobIndustry") or []
        out.append(_job("Jobicy", j.get("id"), j.get("jobTitle"), j.get("companyName"), j.get("jobGeo"), True,
                        industry if isinstance(industry, list) else [industry], j.get("url"), j.get("pubDate"), j.get("jobExcerpt") or j.get("jobDescription"), sal))
    return out


SOURCES = {"Arbeitnow": _arbeitnow, "Remotive": _remotive, "Remote OK": _remoteok, "Jobicy": _jobicy}

SKILLS = ["python", "javascript", "typescript", "react", "node", "java", "kotlin", "go", "rust", "c#", ".net", "php", "laravel", "django", "fastapi",
          "flask", "spring", "sql", "postgresql", "mongodb", "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "linux", "git", "ci/cd",
          "machine learning", "deep learning", "pytorch", "tensorflow", "llm", "nlp", "data science", "pandas", "spark", "power bi", "tableau",
          "figma", "flutter", "react native", "android", "ios", "swift", "next.js", "vue", "angular", "graphql", "rest", "microservices",
          "selenium", "testing", "devops", "security", "excel", "sap", "salesforce", "agile", "scrum", "german"]


def links(keywords: str, location: str) -> list[dict]:
    k, loc = quote_plus(keywords), quote_plus(location or "")
    return [
        {"name": "LinkedIn", "url": f"https://www.linkedin.com/jobs/search/?keywords={k}&location={loc}"},
        {"name": "Indeed", "url": f"https://www.indeed.com/jobs?q={k}&l={loc}"},
        {"name": "Glassdoor", "url": f"https://www.glassdoor.com/Job/jobs.htm?sc.keyword={k}"},
        {"name": "XING (Germany)", "url": f"https://www.xing.com/jobs/search?keywords={k}&location={loc}"},
        {"name": "StepStone (Germany)", "url": f"https://www.stepstone.de/jobs/{quote_plus(keywords.replace(' ', '-'))}"},
        {"name": "Bundesagentur Jobsuche", "url": f"https://www.arbeitsagentur.de/jobsuche/suche?was={k}&wo={loc}"},
        {"name": "Make it in Germany", "url": "https://www.make-it-in-germany.com/en/working-in-germany/job-listings"},
        {"name": "topjobs.lk (Sri Lanka)", "url": "https://www.topjobs.lk/"},
        {"name": "Wellfound (startups)", "url": f"https://wellfound.com/jobs?keywords={k}"},
    ]


def _score(job: dict, words: list[str], location: str) -> int:
    title, tags, body = job["title"].lower(), " ".join(job["tags"]), job["snippet"].lower()
    s = 0
    for w in words:
        s += 4 if w in title else 0
        s += 2 if w in tags else 0
        s += 1 if w in body else 0
    if location and location.lower() in job["location"].lower():
        s += 2
    return s


def search(keywords: list[str], location: str = "", remote_only: bool = False, my_skills: list[str] | None = None) -> dict:
    keywords = [k.strip()[:60] for k in keywords if k and k.strip()][:5]
    if not keywords:
        from fastapi import HTTPException
        raise HTTPException(422, "Add at least one keyword, e.g. Python developer")
    q = " ".join(keywords)
    words = sorted({w for k in keywords for w in re.findall(r"[a-z0-9+#.]{2,}", k.lower())} - {"and", "or", "the", "jobs", "job", "developer", "engineer"}) or [keywords[0].lower()]
    errors: list[str] = []

    def run(item):
        name, fn = item
        try:
            return _cached(f"{name}|{q.lower() if name != 'Arbeitnow' else ''}", lambda: fn(q))
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            errors.append(f"{name} didn't answer ({type(exc).__name__})")
            return []
    with ThreadPoolExecutor(max_workers=4) as pool:
        raw = [j for chunk in pool.map(run, SOURCES.items()) for j in chunk]
    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=90)).isoformat()
    seen, jobs = set(), []
    for j in raw:
        key = (j["title"].lower(), j["company"].lower())
        if key in seen or not j["url"].startswith("http"):
            continue
        if j["posted"] and j["posted"] < cutoff:
            continue
        j = {**j, "score": _score(j, words, location)}
        if j["score"] <= 0 or (remote_only and not j["remote"]):
            continue
        seen.add(key)
        jobs.append(j)
    jobs.sort(key=lambda j: (j["score"], j["posted"] or ""), reverse=True)
    jobs = jobs[:80]
    corpus = [" ".join([j["title"], " ".join(j["tags"]), j["snippet"]]).lower() for j in jobs]
    skill_counts = Counter(s for text in corpus for s in SKILLS if re.search(rf"(?<![a-z]){re.escape(s)}(?![a-z])", text))
    mine = {s.lower().strip() for s in (my_skills or [])}
    gaps = [s for s, _ in skill_counts.most_common(15) if s not in mine][:6]
    germany = sum(1 for j in jobs if re.search(r"germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart", j["location"].lower()))
    visa = sum(1 for t in corpus if re.search(r"visa sponsorship|relocation|sponsor", t))
    return {
        "keywords": keywords, "location": location, "remote_only": remote_only, "jobs": jobs,
        "summary": {
            "total": len(jobs), "remote": sum(1 for j in jobs if j["remote"]), "germany": germany, "visa_or_relocation": visa,
            "by_source": Counter(j["source"] for j in jobs).most_common(),
            "companies": Counter(j["company"] for j in jobs if j["company"] != "—").most_common(8),
            "locations": Counter(j["location"].split(",")[0].strip() for j in jobs).most_common(8),
            "skills": skill_counts.most_common(12), "skills_to_learn": gaps,
            "with_salary": sum(1 for j in jobs if j["salary"]),
        },
        "links": links(q, location), "errors": errors,
        "source_note": "Jobs from Arbeitnow, Remotive, Remote OK and Jobicy (links go to the original post). LinkedIn and others open as searches.",
    }
