"""Travel guide: Sri Lankan and a few international destinations, itineraries and LKR budgets, and your wish list.

All costs are ESTIMATES per person (stay per room-night) for budget / mid-range / luxury travel; check current prices
before booking. Maps use real Google Maps / OpenStreetMap links; international trips link to official UK government
travel advice (FCDO) for current safety information.
"""
from __future__ import annotations

import math
from urllib.parse import quote_plus

TIERS = ("budget", "mid", "luxury")
SL_STAY = {"budget": 7000, "mid": 20000, "luxury": 50000}            # LKR per room per night
SL_FOOD = {"budget": 2500, "mid": 5000, "luxury": 12000}             # LKR per person per day
SL_LOCAL = {"budget": 1500, "mid": 4000, "luxury": 15000}            # LKR per person per day (tuk-tuks / car share / private driver)
SL_TRIP = {"budget": "train or bus", "mid": "intercity bus / train 1st class / taxi share", "luxury": "private car with driver"}
SL_TRIP_COST_PER_HOUR = {"budget": 400, "mid": 1200, "luxury": 5000}  # LKR per person per travel hour, each way

# key: name, region, lat, lon, hours from Colombo by road, best months, tags, highlights [(activity, LKR per person)]
SL = {
    "ella": ("Ella", "Uva hills", 6.8667, 81.0466, 6.5, [1, 2, 3, 4, 7, 8, 9], {"nature", "adventure"},
             [("Nine Arch Bridge walk", 0), ("Little Adam's Peak hike", 0), ("Ella Rock hike", 0), ("Ravana Falls", 0), ("Kandy to Ella scenic train", 2000)]),
    "kandy": ("Kandy", "Central hills", 7.2906, 80.6337, 3.5, [1, 2, 3, 4, 12], {"culture"},
              [("Temple of the Tooth", 2000), ("Peradeniya Botanical Garden", 300), ("Kandy Lake walk", 0), ("Bahirawakanda viewpoint", 0)]),
    "sigiriya": ("Sigiriya & Dambulla", "Cultural triangle", 7.9570, 80.7603, 4.0, [1, 2, 3, 4, 5, 6, 7, 8, 9], {"culture", "adventure"},
                 [("Sigiriya Rock", 1500), ("Pidurangala sunrise", 1000), ("Dambulla Cave Temple", 500), ("Minneriya elephant safari", 9000)]),
    "nuwara_eliya": ("Nuwara Eliya & Horton Plains", "Central hills", 6.9497, 80.7891, 5.0, [1, 2, 3, 4], {"nature"},
                     [("Horton Plains & World's End", 3000), ("Tea factory tour", 500), ("Gregory Lake", 200), ("Victoria Park", 100)]),
    "galle": ("Galle & Unawatuna", "South coast", 6.0329, 80.2168, 2.0, [1, 2, 3, 4, 12], {"culture", "beach"},
              [("Galle Fort walk", 0), ("Unawatuna beach", 0), ("Jungle Beach", 0), ("Japanese Peace Pagoda", 0)]),
    "mirissa": ("Mirissa", "South coast", 5.9483, 80.4716, 2.5, [1, 2, 3, 4, 11, 12], {"beach", "relax"},
                [("Whale watching (Nov-Apr)", 9000), ("Coconut Tree Hill", 0), ("Secret Beach", 0), ("Sunset at Parrot Rock", 0)]),
    "trincomalee": ("Trincomalee & Nilaveli", "East coast", 8.5874, 81.2152, 5.0, [5, 6, 7, 8, 9], {"beach", "culture"},
                    [("Pigeon Island snorkelling", 3500), ("Koneswaram Temple", 0), ("Marble Beach", 0), ("Nilaveli beach", 0)]),
    "arugam_bay": ("Arugam Bay", "East coast", 6.8399, 81.8366, 7.0, [5, 6, 7, 8, 9, 10], {"beach", "adventure"},
                   [("Surf lesson", 5000), ("Kumana National Park safari", 12000), ("Elephant Rock sunset", 0), ("Muhudu Maha Viharaya", 0)]),
    "jaffna": ("Jaffna", "North", 9.6615, 80.0255, 7.0, [1, 2, 3, 4, 5, 6, 7, 8, 9], {"culture"},
               [("Nallur Kandaswamy Kovil", 0), ("Jaffna Fort", 0), ("Casuarina Beach", 0), ("Delft Island ferry trip", 1500)]),
    "anuradhapura": ("Anuradhapura & Mihintale", "Cultural triangle", 8.3114, 80.4037, 4.5, [1, 2, 3, 4, 5, 6, 7, 8, 9], {"culture"},
                     [("Sri Maha Bodhi", 0), ("Ruwanwelisaya", 0), ("Jetavanaramaya", 0), ("Mihintale", 500)]),
    "polonnaruwa": ("Polonnaruwa", "Cultural triangle", 7.9403, 81.0188, 5.0, [1, 2, 3, 4, 5, 6, 7, 8, 9], {"culture"},
                    [("Ancient city by bicycle", 1500), ("Gal Vihara", 0), ("Parakrama Samudra sunset", 0)]),
    "yala": ("Yala & Kataragama", "South-east", 6.3728, 81.5170, 5.5, [2, 3, 4, 5, 6, 7], {"nature", "adventure"},
             [("Yala leopard safari (jeep share)", 12000), ("Kataragama temple", 0), ("Kirinda beach & temple", 0)]),
    "knuckles": ("Knuckles Range", "Central hills", 7.4500, 80.7900, 4.5, [1, 2, 3, 4], {"adventure", "nature"},
                 [("Knuckles guided hike", 6000), ("Pitawala Pathana", 0), ("Meemure village", 0)]),
    "adams_peak": ("Adam's Peak (Sri Pada)", "Central hills", 6.8096, 80.4994, 4.5, [12, 1, 2, 3, 4, 5], {"adventure", "culture"},
                   [("Night climb for sunrise", 0), ("Hatton tea country", 0)]),
    "bentota": ("Bentota", "West coast", 6.4250, 79.9956, 1.5, [1, 2, 3, 4, 11, 12], {"beach", "relax"},
                [("Madu River boat safari", 3000), ("Water sports", 5000), ("Brief Garden", 2000), ("Bentota beach", 0)]),
}

# international: name, currency, approx units per USD (reference only), USD per person per day by tier, return flight USD, FCDO slug, lat, lon, tags, highlights
ABROAD = {
    "maldives": ("Maldives (local islands)", "MVR", 15.4, {"budget": 70, "mid": 150, "luxury": 500}, 250, "maldives", 4.1755, 73.5093, {"beach", "relax"},
                 ["Snorkelling trip", "Sandbank picnic", "Male city walk"]),
    "thailand": ("Thailand (Bangkok & islands)", "THB", 35.0, {"budget": 35, "mid": 80, "luxury": 250}, 350, "thailand", 13.7563, 100.5018, {"culture", "beach"},
                 ["Grand Palace", "Floating market", "Island hopping"]),
    "kerala": ("India (Kerala)", "INR", 85.0, {"budget": 25, "mid": 60, "luxury": 200}, 200, "india", 9.9312, 76.2673, {"nature", "culture"},
               ["Alleppey houseboat", "Munnar tea hills", "Fort Kochi"]),
    "japan": ("Japan (Tokyo & Kyoto)", "JPY", 150.0, {"budget": 80, "mid": 150, "luxury": 400}, 900, "japan", 35.6762, 139.6503, {"culture"},
              ["Shibuya & Asakusa", "Kyoto temples", "Bullet train"]),
    "germany": ("Germany (Berlin & Munich)", "EUR", 0.9, {"budget": 70, "mid": 140, "luxury": 350}, 900, "germany", 52.5200, 13.4050, {"culture"},
                ["Brandenburg Gate", "Museum Island", "University visits"]),
}


def maps_link(lat: float, lon: float, name: str) -> dict:
    return {"directions": f"https://www.google.com/maps/dir/?api=1&origin=Colombo&destination={lat},{lon}",
            "place": f"https://www.google.com/maps/search/?api=1&query={quote_plus(name)}",
            "embed": f"https://www.openstreetmap.org/export/embed.html?bbox={lon - 0.15}%2C{lat - 0.1}%2C{lon + 0.15}%2C{lat + 0.1}&layer=mapnik&marker={lat}%2C{lon}"}


def destinations(month: int | None = None, interest: str | None = None) -> list[dict]:
    out = []
    for k, (name, region, lat, lon, hours, months, tags, hl) in SL.items():
        out.append({"key": k, "name": name, "region": region, "country": "Sri Lanka", "hours_from_colombo": hours, "best_months": months, "tags": sorted(tags),
                    "highlights": [h for h, _ in hl], "good_now": month in months if month else None, "maps": maps_link(lat, lon, name)})
    for k, (name, cur, _rate, _day, _flight, slug, lat, lon, tags, hl) in ABROAD.items():
        out.append({"key": k, "name": name, "region": "Abroad", "country": name.split(" (")[0], "currency": cur, "tags": sorted(tags), "highlights": hl,
                    "advisory": f"https://www.gov.uk/foreign-travel-advice/{slug}", "maps": maps_link(lat, lon, name), "good_now": None})
    if interest:
        out = [d for d in out if interest in d["tags"]]
    return sorted(out, key=lambda d: (d["good_now"] is False, d["region"] == "Abroad", d.get("hours_from_colombo", 99)))


def plan(key: str, days: int, tier: str, people: int, usd_lkr: float) -> dict:
    if tier not in TIERS:
        raise ValueError("tier")
    rooms = math.ceil(people / 2)
    nights = max(0, days - 1)
    if key in SL:
        name, region, lat, lon, hours, months, tags, hl = SL[key]
        travel = round(2 * hours * SL_TRIP_COST_PER_HOUR[tier] * people)
        stay = SL_STAY[tier] * nights * rooms
        food = SL_FOOD[tier] * days * people
        local = SL_LOCAL[tier] * days * people
        acts = list(hl)
        it, act_cost = [], 0
        for d in range(1, days + 1):
            todo = [f"Travel from Colombo (~{hours} h by {SL_TRIP[tier]})"] if d == 1 else []
            per_day = 1 if d in (1, days) and days > 1 else 2          # travel days have room for one thing
            picked = 0
            while acts and picked < per_day:
                a, c = acts.pop(0)
                todo.append(a)
                act_cost += c
                picked += 1
            if not picked:
                todo.append("Free time: rest, local food, explore nearby")
            if d == days and days > 1:
                todo.append("Travel back to Colombo")
            it.append({"day": d, "plan": todo})
        activities = act_cost * people
        total = travel + stay + food + local + activities
        return {"destination": name, "region": region, "country": "Sri Lanka", "days": days, "nights": nights, "tier": tier, "people": people, "rooms": rooms,
                "itinerary": it, "best_months": months, "maps": maps_link(lat, lon, name),
                "budget_lkr": {"transport_to_and_back": travel, "stay": stay, "food": food, "local_transport": local, "activities": activities, "total": total},
                "per_person_lkr": round(total / people), "total_usd": round(total / usd_lkr), "usd_lkr": usd_lkr,
                "note": "Estimates for planning; prices change by season. Book stays and check entry fees before you go."}
    if key in ABROAD:
        name, cur, rate, day_usd, flight, slug, lat, lon, tags, hl = ABROAD[key]
        daily = day_usd[tier] * days * people
        flights = flight * people
        total_usd = daily + flights
        it = [{"day": d, "plan": ([f"Fly from Colombo to {name.split(' (')[0]}"] if d == 1 else []) + ([hl[(d - 1) % len(hl)]] if 1 < d < days or days == 1 else [])
               + (["Fly back to Colombo"] if d == days and days > 1 else [])} for d in range(1, days + 1)]
        return {"destination": name, "region": "Abroad", "country": name.split(" (")[0], "days": days, "nights": nights, "tier": tier, "people": people,
                "itinerary": it, "maps": maps_link(lat, lon, name), "advisory": f"https://www.gov.uk/foreign-travel-advice/{slug}",
                "budget_usd": {"flights": flights, "stay_food_transport_activities": daily, "total": total_usd},
                "total_lkr": round(total_usd * usd_lkr), "per_person_lkr": round(total_usd * usd_lkr / people), "usd_lkr": usd_lkr,
                "local_currency": {"code": cur, "per_usd": rate, "total": round(total_usd * rate), "note": "approximate reference rate"},
                "visa": "Check visa rules for Sri Lankan passport holders on the official embassy or government site before booking.",
                "note": "Rough estimates for planning; check current flight and hotel prices and the official travel advice."}
    raise KeyError(key)
