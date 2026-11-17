"""German and English: new flashcards every day (from a built-in word bank) and a timed plan for today.

The bank is plain data, so it works with no AI key. Words are added in order and never repeated (one deck per language).
"""
from __future__ import annotations

from datetime import date
from urllib.parse import quote_plus

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import Flashcard

# (front, back, example)
GERMAN: list[tuple[str, str, str]] = [
    ("der Termin", "appointment", "Ich habe morgen einen Termin beim Arzt."), ("die Erfahrung", "experience", "Ich habe drei Jahre Erfahrung als Entwickler."),
    ("sich bewerben (um)", "to apply (for)", "Ich bewerbe mich um eine Stelle in Berlin."), ("die Stelle", "job, position", "Die Stelle ist ab Januar frei."),
    ("der Lebenslauf", "CV, résumé", "Bitte schicken Sie Ihren Lebenslauf."), ("das Vorstellungsgespräch", "job interview", "Das Vorstellungsgespräch war gut."),
    ("die Wohnung", "apartment", "Wir suchen eine Wohnung in München."), ("die Miete", "rent", "Die Miete ist 800 Euro im Monat."),
    ("einkaufen", "to shop", "Am Samstag kaufe ich ein."), ("der Bahnhof", "train station", "Wo ist der Bahnhof?"),
    ("die Fahrkarte", "ticket", "Ich brauche eine Fahrkarte nach Köln."), ("pünktlich", "on time", "Der Zug ist pünktlich."),
    ("die Verspätung", "delay", "Der Bus hat zehn Minuten Verspätung."), ("das Gehalt", "salary", "Das Gehalt ist gut."),
    ("die Steuer", "tax", "Ich muss Steuern zahlen."), ("die Versicherung", "insurance", "Ich brauche eine Krankenversicherung."),
    ("anmelden", "to register", "Ich muss mich bei der Stadt anmelden."), ("das Konto", "bank account", "Ich eröffne ein Konto."),
    ("überweisen", "to transfer (money)", "Ich überweise das Geld morgen."), ("die Rechnung", "bill, invoice", "Die Rechnung kommt per E-Mail."),
    ("der Kollege / die Kollegin", "colleague", "Meine Kollegen sind sehr nett."), ("die Besprechung", "meeting", "Die Besprechung beginnt um zehn."),
    ("die Aufgabe", "task", "Das ist eine schwierige Aufgabe."), ("erledigen", "to get done", "Ich erledige das heute."),
    ("die Frist", "deadline", "Die Frist endet am Freitag."), ("verschieben", "to postpone", "Können wir das Treffen verschieben?"),
    ("vorschlagen", "to suggest", "Ich schlage Dienstag vor."), ("zustimmen", "to agree", "Ich stimme dir zu."),
    ("die Meinung", "opinion", "Meiner Meinung nach ist das richtig."), ("deshalb", "therefore", "Es regnet, deshalb bleibe ich zu Hause."),
    ("trotzdem", "nevertheless", "Es ist kalt, trotzdem gehe ich laufen."), ("obwohl", "although", "Obwohl ich müde bin, lerne ich."),
    ("weil", "because (verb at end)", "Ich lerne Deutsch, weil ich in Deutschland studieren will."), ("dass", "that (conj.)", "Ich glaube, dass es klappt."),
    ("wenn", "when / if", "Wenn ich Zeit habe, rufe ich dich an."), ("als", "when (past, once)", "Als ich klein war, wohnte ich in Kandy."),
    ("seit", "since / for", "Ich lerne seit drei Monaten Deutsch."), ("während", "during / while", "Während des Kurses mache ich Notizen."),
    ("die Hochschule", "university (of applied sciences)", "Ich studiere an einer Hochschule."), ("das Studium", "studies", "Das Studium dauert vier Semester."),
    ("die Vorlesung", "lecture", "Die Vorlesung ist um neun Uhr."), ("die Prüfung", "exam", "Ich habe nächste Woche eine Prüfung."),
    ("bestehen", "to pass (an exam)", "Ich habe die Prüfung bestanden."), ("die Zulassung", "admission", "Ich habe die Zulassung bekommen!"),
    ("das Stipendium", "scholarship", "Sie hat ein Stipendium vom DAAD."), ("das Visum", "visa", "Ich beantrage ein Studentenvisum."),
    ("das Sperrkonto", "blocked account", "Für das Visum brauche ich ein Sperrkonto."), ("die Unterlagen", "documents", "Alle Unterlagen sind vollständig."),
    ("ausfüllen", "to fill in", "Bitte füllen Sie das Formular aus."), ("unterschreiben", "to sign", "Hier unterschreiben, bitte."),
    ("die Gesundheit", "health", "Gesundheit ist das Wichtigste."), ("sich erholen", "to recover, relax", "Am Wochenende erhole ich mich."),
    ("das Fitnessstudio", "gym", "Ich gehe viermal pro Woche ins Fitnessstudio."), ("müde", "tired", "Ich bin heute sehr müde."),
    ("der Schlüssel", "key", "Ich habe meinen Schlüssel verloren."), ("vergessen", "to forget", "Vergiss deinen Pass nicht!"),
    ("sich erinnern (an)", "to remember", "Ich erinnere mich an den Urlaub."), ("sich freuen (auf)", "to look forward (to)", "Ich freue mich auf das Wochenende."),
    ("sich kümmern (um)", "to take care (of)", "Ich kümmere mich um die Tickets."), ("sich beschäftigen (mit)", "to deal with", "Ich beschäftige mich mit KI."),
    ("die Entwicklung", "development", "Die Entwicklung der App dauert lange."), ("der Fehler", "mistake, bug", "Ich habe einen Fehler im Code gefunden."),
    ("die Lösung", "solution", "Wir haben eine Lösung gefunden."), ("verbessern", "to improve", "Ich will mein Deutsch verbessern."),
    ("die Fähigkeit", "skill, ability", "Teamarbeit ist eine wichtige Fähigkeit."), ("das Ziel", "goal", "Mein Ziel ist B2 bis Juni."),
    ("erreichen", "to reach, achieve", "Ich erreiche mein Ziel."), ("die Gewohnheit", "habit", "Lesen ist eine gute Gewohnheit."),
    ("regelmäßig", "regularly", "Ich lerne regelmäßig."), ("ungefähr", "approximately", "Es dauert ungefähr eine Stunde."),
    ("eigentlich", "actually", "Eigentlich wollte ich heute früh schlafen."), ("vielleicht", "maybe", "Vielleicht komme ich später."),
    ("sowieso", "anyway", "Ich muss sowieso einkaufen."), ("allerdings", "however", "Das ist teuer, allerdings sehr gut."),
    ("zwar … aber", "admittedly … but", "Es ist zwar spät, aber ich arbeite noch."), ("entweder … oder", "either … or", "Entweder heute oder morgen."),
    ("sowohl … als auch", "both … and", "Ich spreche sowohl Englisch als auch Deutsch."), ("je … desto", "the … the", "Je mehr ich übe, desto besser werde ich."),
    ("die Umwelt", "environment", "Wir müssen die Umwelt schützen."), ("die Gesellschaft", "society, company", "Die Gesellschaft verändert sich."),
    ("der Vorteil", "advantage", "Ein Vorteil ist die Flexibilität."), ("der Nachteil", "disadvantage", "Der Nachteil ist der Preis."),
    ("beschreiben", "to describe", "Beschreiben Sie das Bild."), ("vergleichen", "to compare", "Vergleichen Sie die beiden Angebote."),
    ("die Ursache", "cause", "Was ist die Ursache des Problems?"), ("die Folge", "consequence", "Die Folge ist Stress."),
    ("teilnehmen (an)", "to take part (in)", "Ich nehme an dem Kurs teil."), ("sich entscheiden (für)", "to decide (on)", "Ich entscheide mich für Berlin."),
]
ENGLISH: list[tuple[str, str, str]] = [
    ("mitigate", "make less severe", "New rules aim to mitigate the risks of AI."), ("feasible", "possible and practical", "Remote work is feasible for most developers."),
    ("substantial", "large in amount or importance", "There was a substantial increase in prices."), ("prevalent", "common, widespread", "Smartphones are prevalent among teenagers."),
    ("detrimental", "harmful", "Lack of sleep is detrimental to health."), ("advocate", "publicly support", "Many experts advocate shorter working weeks."),
    ("comprehensive", "complete, including everything", "The report gives a comprehensive overview."), ("allocate", "distribute for a purpose", "Governments should allocate more funds to education."),
    ("consequently", "as a result", "Costs rose; consequently, demand fell."), ("nevertheless", "in spite of that", "It was expensive; nevertheless, it sold well."),
    ("whereas", "while on the other hand", "Some prefer cities, whereas others like the countryside."), ("in contrast", "showing a difference", "In contrast, rural areas grew slowly."),
    ("fluctuate", "rise and fall irregularly", "Sales fluctuated throughout the year."), ("plummet", "fall suddenly and steeply", "Prices plummeted in March."),
    ("surge", "sudden large increase", "There was a surge in online shopping."), ("steadily", "gradually and evenly", "The number rose steadily over the decade."),
    ("account for", "make up (a proportion)", "Cars account for 40% of emissions."), ("approximately", "roughly", "Approximately half of students work part-time."),
    ("a significant proportion", "a large share", "A significant proportion of income goes on rent."), ("to a certain extent", "partly", "I agree to a certain extent."),
    ("undeniably", "without doubt", "Technology has undeniably changed education."), ("exacerbate", "make worse", "Traffic exacerbates air pollution."),
    ("alleviate", "make less bad", "Public transport can alleviate congestion."), ("inevitable", "certain to happen", "Change is inevitable."),
    ("crucial", "extremely important", "Practice is crucial for fluency."), ("diverse", "varied", "Cities have diverse populations."),
    ("enhance", "improve the quality of", "Exercise enhances concentration."), ("foster", "encourage the growth of", "Teamwork fosters creativity."),
    ("hinder", "make difficult", "Poor internet hinders remote learning."), ("implement", "put into effect", "The company implemented a new policy."),
    ("integral", "essential", "Testing is integral to software development."), ("justify", "show to be right", "Can high prices be justified?"),
    ("leverage", "use to maximum advantage", "Startups leverage cloud services."), ("notion", "idea, belief", "The notion of a job for life is outdated."),
    ("obsolete", "no longer used", "Fax machines are almost obsolete."), ("paramount", "most important", "Safety is paramount."),
    ("pursue", "follow, try to achieve", "She decided to pursue a Master's in Germany."), ("reluctant", "unwilling", "People are reluctant to change habits."),
    ("scrutinise", "examine carefully", "Reviewers scrutinise every line of code."), ("sustainable", "able to continue long-term", "We need sustainable energy."),
    ("tangible", "real, measurable", "The training brought tangible results."), ("ubiquitous", "found everywhere", "Mobile phones are ubiquitous."),
    ("viable", "workable", "Is solar power a viable alternative?"), ("widespread", "affecting many", "There is widespread concern about privacy."),
    ("in the long run", "eventually, over time", "Saving money pays off in the long run."), ("on the other hand", "introducing a contrast", "On the other hand, it is costly."),
    ("it could be argued that", "a cautious claim", "It could be argued that exams cause stress."), ("a case in point", "a relevant example", "Sri Lanka's tourism is a case in point."),
    ("to tackle", "deal with a problem", "We must tackle unemployment."), ("to bridge the gap", "reduce a difference", "Online courses bridge the gap in education."),
    ("trade-off", "balance between two things", "There is a trade-off between speed and quality."), ("bottleneck", "point that slows everything", "The database is the bottleneck."),
    ("stakeholder", "person with an interest", "Inform all stakeholders before release."), ("deadline-driven", "working toward fixed dates", "Our team is very deadline-driven."),
    ("proactive", "acting in advance", "Be proactive about follow-ups."), ("scalable", "able to grow easily", "We need a scalable architecture."),
    ("concise", "short and clear", "Keep your answer concise."), ("articulate", "express clearly", "She articulated her ideas well."),
    ("elaborate (on)", "give more detail", "Could you elaborate on that point?"), ("summarise", "give the main points", "Let me summarise the discussion."),
    ("in a nutshell", "in short", "In a nutshell, the plan worked."), ("bear in mind", "remember, consider", "Bear in mind the cost of living."),
    ("cope with", "deal successfully with", "How do you cope with stress?"), ("look forward to (+ing)", "be excited about", "I look forward to hearing from you."),
    ("be keen on", "be interested in", "I'm keen on machine learning."), ("come up with", "think of an idea", "We came up with a solution."),
    ("figure out", "understand, solve", "I figured out the bug."), ("carry out", "perform, do", "We carried out a survey."),
    ("set up", "establish, arrange", "They set up a small business."), ("put off", "postpone", "Don't put off your assignments."),
    ("take up", "start a hobby/activity", "I took up running last year."), ("get across", "communicate an idea", "He got his point across."),
    ("by and large", "generally", "By and large, the project went well."), ("to my mind", "in my opinion", "To my mind, education should be free."),
    ("remarkable", "worth noticing", "There was a remarkable improvement."), ("negligible", "too small to matter", "The difference was negligible."),
    ("predominantly", "mainly", "The audience was predominantly young."), ("subsequently", "afterwards", "He moved to Berlin and subsequently found a job."),
    ("thereby", "by that means", "Automation saves time, thereby cutting costs."), ("albeit", "although", "It worked, albeit slowly."),
]
BANKS = {"german": GERMAN, "english": ENGLISH}
DECK = {"german": "german-daily", "english": "english-daily"}
TOPICS = {  # what to watch / practise, rotating by day
    "german": ["German A2 listening practice", "German modal verbs explained", "German dative vs accusative", "German Perfekt tense",
               "Easy German street interviews", "German for job interviews", "German B1 speaking practice", "German separable verbs"],
    "english": ["IELTS speaking part 2 sample answer", "IELTS writing task 2 structure", "IELTS listening practice test", "English phrasal verbs for work",
                "IELTS reading tips true false not given", "English pronunciation practice", "Business English meetings", "IELTS writing task 1 line graph"],
}
CHANNELS = {
    "german": [{"name": "Easy German", "url": "https://www.youtube.com/@EasyGerman/videos"}, {"name": "DW Learn German", "url": "https://www.youtube.com/@dwlearngerman/videos"},
               {"name": "Learn German with Anja", "url": "https://www.youtube.com/@LearnGermanwithAnja/videos"}, {"name": "Deutsch mit Marija", "url": "https://www.youtube.com/@DeutschmitMarija/videos"}],
    "english": [{"name": "BBC Learning English", "url": "https://www.youtube.com/@bbclearningenglish/videos"}, {"name": "English with Lucy", "url": "https://www.youtube.com/@EnglishwithLucy/videos"},
                {"name": "IELTS Liz", "url": "https://www.youtube.com/@ieltsliz/videos"}, {"name": "E2 IELTS", "url": "https://www.youtube.com/@E2IELTS/videos"}],
}


def _ai_words(db: Session, user_id, lang: str, have: set[str], n: int) -> list[tuple[str, str, str]]:
    """When the built-in bank is used up: ask the AI for new words (if AI is on). Strict JSON; anything odd is dropped."""
    import json
    from app.services.ai_client import ai_enabled, cached_complete, model_for
    if not ai_enabled():
        return []
    level = "A2-B1 German (with article for nouns)" if lang == "german" else "IELTS band 7 academic English"
    system = (f"Give {n + 5} useful {level} vocabulary items for a Sri Lankan software engineer preparing to study in Germany. "
              'Reply ONLY with JSON: [{"front": "...", "back": "English meaning", "example": "short sentence"}]. No markdown.')
    known = ", ".join(sorted(have)[-150:])
    text = cached_complete(db, user_id, "language_words", model_for("classification"),
                           [{"role": "system", "content": system}, {"role": "user", "content": f"Already known (don't repeat): {known}"[:5000]}], 0.7, ttl_hours=20)
    try:
        rows = json.loads((text or "[]").strip().strip("`").removeprefix("json"))
    except ValueError:
        return []
    out = []
    for r in rows if isinstance(rows, list) else []:
        f, b, e = str(r.get("front", "")).strip()[:120], str(r.get("back", "")).strip()[:200], str(r.get("example", "")).strip()[:300]
        if f and b and f not in have and all(f != x[0] for x in out):
            out.append((f, b, e))
    return out[:n]


def add_daily_cards(db: Session, user_id, lang: str, today: date, count: int = 5) -> dict:
    """Add today's new words (once per day). The next words are the first ones from the bank not yet in your deck."""
    from datetime import datetime, time
    from app.core.clock import now_utc
    deck = DECK[lang]
    have = set(db.scalars(select(Flashcard.front).where(Flashcard.user_id == user_id, Flashcard.deck == deck)).all())
    today_start = datetime.combine(today, time.min)
    added_today = db.scalar(select(func.count()).select_from(Flashcard).where(Flashcard.user_id == user_id, Flashcard.deck == deck,
                                                                              Flashcard.created_at >= today_start)) or 0
    fresh = [w for w in BANKS[lang] if w[0] not in have][:max(0, count - added_today)]
    if not fresh and added_today < count:
        fresh = _ai_words(db, user_id, lang, have, count - added_today)
    for front, back, example in fresh:
        db.add(Flashcard(user_id=user_id, deck=deck, front=front, back=back, example=example, due_at=now_utc()))
    db.flush()
    return {"lang": lang, "deck": deck, "added": len(fresh), "added_today": added_today + len(fresh),
            "left_in_bank": len([w for w in BANKS[lang] if w[0] not in have]) - len(fresh), "words": [{"front": f, "back": b, "example": e} for f, b, e in fresh]}


def today_plan(db: Session, user_id, today: date) -> dict:
    """German + English for today: exam-coach minutes, new and due cards, one video topic each, with times."""
    from app.core.clock import now_utc
    from app.services import exams
    plans = [exams.plan_out(db, p) for p in exams.ensure_defaults(db, user_id) if p.active]
    out = []
    for lang, exam_key in (("german", "goethe"), ("english", "ielts")):
        deck = DECK[lang]
        due = db.scalar(select(func.count()).select_from(Flashcard).where(Flashcard.user_id == user_id, Flashcard.deck == deck,
                                                                          Flashcard.suspended.is_(False), Flashcard.due_at <= now_utc())) or 0
        total = db.scalar(select(func.count()).select_from(Flashcard).where(Flashcard.user_id == user_id, Flashcard.deck == deck)) or 0
        plan = next((p for p in plans if p.get("exam") == exam_key), None)
        blocks = (plan or {}).get("today", {}).get("blocks", []) if plan else []
        topic = TOPICS[lang][today.toordinal() % len(TOPICS[lang])]
        steps = [{"what": f"Review {due} flashcard{'s' if due != 1 else ''} ({lang})", "minutes": max(5, min(20, due)), "kind": "cards"},
                 {"what": f"Watch: {topic}", "minutes": 15, "kind": "video", "url": f"https://www.youtube.com/results?search_query={quote_plus(topic)}"}]
        steps += [{"what": f"{b.get('label')}: {b.get('activity')}", "minutes": b.get("minutes", 15), "kind": "exam"} for b in blocks]
        out.append({"lang": lang, "title": "🇩🇪 German" if lang == "german" else "🇬🇧 English (IELTS)", "deck": deck, "cards_due": due, "cards_total": total,
                    "steps": steps, "minutes": sum(s["minutes"] for s in steps), "channels": CHANNELS[lang],
                    "exam": {"name": plan.get("name"), "days_left": plan.get("readiness", {}).get("days_left")} if plan else None})
    return {"date": today, "languages": out, "total_minutes": sum(x["minutes"] for x in out)}
