"""WhatsApp-style chat logic for the SkyBite demo.

Everything the phone page does ends up here. The functions only talk to the database, so the
same code could later sit behind the real WhatsApp Business API.

Message directions (from the airline's point of view):
    "out" = the airline sends it, "in" = the passenger sends it.
"""
import json
import re
import sqlite3
from datetime import datetime

import passenger_features as pf


# --------------------------------------------------------------------------- small helpers

def fmt_day(dt):
    return f"{dt.strftime('%a')} {dt.day} {dt.strftime('%b')}"      # no %-d, which breaks on Windows


def fmt_time(dt):
    return dt.strftime("%H:%M")


def send(conn, pnr, direction, body, actions=None, kind="chat"):
    """Save one chat message. The caller commits."""
    conn.execute(
        "INSERT INTO messages (pnr, direction, body, actions, kind, sent_at) VALUES (?,?,?,?,?,?)",
        (pnr, direction, body, json.dumps(actions) if actions else None, kind,
         datetime.now().isoformat(timespec="seconds")))


def has_chat(conn, pnr):
    return conn.execute("SELECT 1 FROM messages WHERE pnr = ? LIMIT 1", (pnr,)).fetchone() is not None


def _people(conn, pnr):
    return conn.execute("SELECT * FROM passengers WHERE pnr = ? ORDER BY id", (pnr,)).fetchall()


def _int(text):
    try:
        return int(text)
    except (TypeError, ValueError):
        return None


def _reply(conn, pnr, text, actions=None):
    send(conn, pnr, "out", text, actions)


# --------------------------------------------------------------------------- the 48-hour message

def reminder_text(people, flight, festivals, meal_names):
    first = people[0]["first_name"]
    lines = [
        f"Hey {first}, how are you? 👋",
        "",
        f"Your flight *{flight['number']}* to {flight['dest_city']} leaves on "
        f"{fmt_day(flight['departs'])} at {fmt_time(flight['departs'])}. That is 48 hours from now.",
    ]
    if festivals:
        name = festivals[0]["name"]
        lines += ["", f"It falls during {name}, so we have special {name} meals ready for you."]
    lines += ["", "Meals right now:"]
    for p in people:
        lines.append(f"• {p['first_name']}: {meal_names.get(p['meal_code'], 'not chosen yet')}")
    cutoff = flight["cutoff"]
    lines += ["", f"You can choose or change meals until {fmt_time(cutoff)} on {fmt_day(cutoff)}. "
                  "Tap *Choose meal* to start."]
    return "\n".join(lines)


def _booking_groups(conn):
    groups = {}
    for row in conn.execute("SELECT * FROM passengers WHERE flight_id = 1 ORDER BY pnr, id"):
        groups.setdefault(row["pnr"], []).append(row)
    return groups


def _meal_names(conn):
    return {m["code"]: m["name"] for m in conn.execute("SELECT code, name FROM meals")}


def send_reminders(conn, flight, festivals):
    """Send the 48-hour meal-planning message once to each booking."""
    meal_names = _meal_names(conn)
    sent = 0
    for pnr, people in _booking_groups(conn).items():
        already = conn.execute(
            "SELECT 1 FROM messages WHERE pnr = ? AND kind = 'reminder48' LIMIT 1", (pnr,)
        ).fetchone()
        if already:
            continue
        send(conn, pnr, "out", reminder_text(people, flight, festivals, meal_names),
             {"buttons": [{"label": "Choose meal", "payload": "start"}]}, kind="reminder48")
        sent += 1
    return sent


def reminder6_text(people, flight, festivals, meal_names):
    """Two-hour warning before the four-hour meal cutoff (six hours before departure)."""
    first = people[0]["first_name"]
    cutoff = flight["cutoff"]
    lines = [
        f"Quick meal reminder, {first}! 👋",
        "",
        f"Your flight *{flight['number']}* to {flight['dest_city']} departs at "
        f"{fmt_time(flight['departs'])} on {fmt_day(flight['departs'])}.",
        "",
        "⏳ Meal selection closes in 2 hours, at "
        f"{fmt_time(cutoff)} on {fmt_day(cutoff)}.",
    ]
    if festivals:
        lines += ["", f"{festivals[0]['name']} special meals are available while stock lasts."]
    lines += ["", "Current selections:"]
    for person in people:
        lines.append(f"• {person['first_name']}: {meal_names.get(person['meal_code'], 'not chosen yet')}")
    lines += ["", "Choose or change your meal now. After the cutoff, changes need crew approval and depend on availability."]
    return "\n".join(lines)


def send_six_hour_reminders(conn, flight, festivals):
    """Send the six-hour warning once to each booking. Returns number of bookings reached."""
    meal_names = _meal_names(conn)
    sent = 0
    for pnr, people in _booking_groups(conn).items():
        already = conn.execute(
            "SELECT 1 FROM messages WHERE pnr = ? AND kind = 'reminder6' LIMIT 1", (pnr,)
        ).fetchone()
        if already:
            continue
        send(conn, pnr, "out", reminder6_text(people, flight, festivals, meal_names),
             {"buttons": [{"label": "Choose meal", "payload": "start"}]}, kind="reminder6")
        sent += 1
    return sent


def cutoff_text(people, flight):
    first = people[0]["first_name"]
    cutoff = flight["cutoff"]
    return "\n".join([
        f"Meal selection is now closed, {first}. 🔒",
        "",
        f"Normal meal changes for flight *{flight['number']}* closed at "
        f"{fmt_time(cutoff)} on {fmt_day(cutoff)} (4 hours before departure).",
        "",
        "Your last confirmed meal remains in place. You can still request a change, "
        "but it will stay pending until the crew reviews availability and approves or declines it.",
    ])


def send_cutoff_reminders(conn, flight):
    """Notify every booking that normal meal selection has closed."""
    sent = 0
    for pnr, people in _booking_groups(conn).items():
        already = conn.execute(
            "SELECT 1 FROM messages WHERE pnr = ? AND kind = 'reminder4' LIMIT 1", (pnr,)
        ).fetchone()
        if already:
            continue
        send(conn, pnr, "out", cutoff_text(people, flight),
             {"buttons": [{"label": "Request meal change", "payload": "start"}]}, kind="reminder4")
        sent += 1
    return sent


# --------------------------------------------------------------------------- replying to taps

def _closed(conn, pnr, flight):
    cutoff = flight["cutoff"]
    _reply(conn, pnr,
           f"Normal meal changes closed at {fmt_time(cutoff)} on {fmt_day(cutoff)}. "
           "You can still submit a late request; the crew must review it before any confirmed meal changes.",
           {"buttons": [{"label": "Request meal change", "payload": "start"}]})


def _offer_list(conn, pnr, person, meals, festivals, locked=False):
    rows = [{"payload": f"meal:{person['id']}:{m['code']}", "title": m["name"],
             "desc": m["description"], "color": m["color"], "festival": bool(m["festival_only"])}
            for m in meals]
    text = f"Here are the meal options for *{person['first_name']}* (seat {person['seat']})."
    if festivals:
        text += f" The {festivals[0]['name']} specials are at the top."
    if locked:
        text += " Normal changes are closed: selecting an option sends a late request for crew approval. The existing meal stays confirmed until the crew decides."
    _reply(conn, pnr, text, {"list": {"label": "See meal options",
                                       "title": f"Meals for {person['first_name']}", "rows": rows}})


def _late_request(conn, pnr, person, meal, now):
    """Create a pending late request without overwriting the passenger's confirmed meal."""
    if person["meal_code"] == meal["code"]:
        return _reply(conn, pnr, f"*{meal['name']}* is already confirmed for {person['first_name']} (seat {person['seat']}). No change was needed.")
    active = conn.execute(
        "SELECT id FROM late_meal_requests WHERE passenger_id = ? AND status IN ('pending','alternative_offered') LIMIT 1",
        (person["id"],),
    ).fetchone()
    if active:
        return _reply(conn, pnr,
                      f"There is already a late meal request being reviewed for {person['first_name']} (seat {person['seat']}). Your current meal stays confirmed while the crew reviews it.")
    old_dish_code = pf.current_dish(conn, person["id"], person["meal_code"])
    requested_dish_code = pf.default_dish(meal["code"])
    requested_dish_name = pf.dish_label(requested_dish_code)
    try:
        conn.execute(
            """INSERT INTO late_meal_requests
               (passenger_id, old_meal_code, requested_meal_code, old_dish_code, requested_dish_code, status, requested_at)
               VALUES (?,?,?,?,?, 'pending', ?)""",
            (person["id"], person["meal_code"], meal["code"], old_dish_code, requested_dish_code, now.isoformat()),
        )
    except sqlite3.IntegrityError:
        # The partial unique index protects against two rapid taps creating active requests.
        return _reply(conn, pnr,
                      f"There is already a late meal request being reviewed for {person['first_name']} (seat {person['seat']}). Your current meal stays confirmed while the crew reviews it.")
    old = person["meal_code"]
    old_name = conn.execute("SELECT name FROM meals WHERE code = ?", (old,)).fetchone() if old else None
    previous = old_name["name"] if old_name else "No meal selected yet"
    return _reply(conn, pnr,
                  f"Late request received for *{requested_dish_name}* ({meal['name']}) at seat {person['seat']}. Your previous selection ({previous}) remains unchanged for now. The crew will review stock and confirm or decline the request.")


def _save_and_confirm(conn, pnr, person, meal, people, flight, now):
    stamp = now.isoformat()
    old_dish_code = pf.current_dish(conn, person["id"], person["meal_code"])
    new_dish_code = pf.default_dish(meal["code"])
    new_dish_name = pf.dish_label(new_dish_code)
    conn.execute("UPDATE passengers SET meal_code = ?, meal_source = 'whatsapp', meal_updated_at = ? "
                 "WHERE id = ?", (meal["code"], stamp, person["id"]))
    pf.save_current_dish(conn, person["id"], meal["code"], new_dish_code, stamp, source="whatsapp")
    conn.execute("""INSERT INTO meal_events
                 (passenger_id, old_meal, new_meal, source, at, old_dish_code, new_dish_code)
                 VALUES (?,?,?,?,?,?,?)""",
                 (person["id"], person["meal_code"], meal["code"], "whatsapp", stamp, old_dish_code, new_dish_code))
    cutoff = flight["cutoff"]
    text = (f"Done, {person['first_name']}! ✅\n*{new_dish_name}* ({meal['name']}) is confirmed for seat {person['seat']}.\n"
            f"{meal['description']}\n\nThe kitchen and the website are updated. "
            f"You can change it until {fmt_time(cutoff)} on {fmt_day(cutoff)}.")
    waiting = [p for p in people if p["meal_code"] is None and p["id"] != person["id"]]
    if waiting:
        buttons = [{"label": f"Choose for {p['first_name']}", "payload": f"who:{p['id']}"} for p in waiting[:3]]
    else:
        buttons = [{"label": "Change a meal", "payload": "start"}]
    _reply(conn, pnr, text, {"buttons": buttons})


def handle_action(conn, pnr, payload, flight, now, meals, festivals):
    """Handle a button or list row; the server re-checks the request and cutoff."""
    people = _people(conn, pnr)
    by_id = {p["id"]: p for p in people}
    allowed = {m["code"]: m for m in meals}
    locked = now >= flight["cutoff"]
    kind, _, rest = payload.partition(":")

    if kind == "start":
        send(conn, pnr, "in", "Request meal change" if locked else "Choose meal")
        if len(people) == 1:
            return _offer_list(conn, pnr, people[0], meals, festivals, locked=locked)
        intro = "The meal cutoff has passed; any new selection will need crew approval. " if locked else ""
        buttons = [{"label": p["first_name"], "payload": f"who:{p['id']}"} for p in people]
        return _reply(conn, pnr, intro + "Who is this meal for?", {"buttons": buttons})

    if kind == "who":
        person = by_id.get(_int(rest))
        if person is None:
            return
        send(conn, pnr, "in", person["first_name"])
        return _offer_list(conn, pnr, person, meals, festivals, locked=locked)

    if kind in ("meal", "assign"):
        pid, _, code = rest.partition(":")
        person, meal = by_id.get(_int(pid)), allowed.get(code)
        if person is None or meal is None:
            return
        send(conn, pnr, "in", meal["name"] if kind == "meal" else person["first_name"])
        if locked:
            return _late_request(conn, pnr, person, meal, now)
        return _save_and_confirm(conn, pnr, person, meal, people, flight, now)


# --------------------------------------------------------------------------- typed messages
# Rule-based for now: it looks for words like "jain" or "peanut". Order matters, so
# "non-veg" is checked before "veg". A language model can replace guess_meal() later.

KEYWORDS = [
    ("jain", ["jain"]),
    ("ekadashi", ["ekadashi"]),
    ("navratri", ["navratri", "navaratri", "vrat", "fast", "fasting", "upvas", "sabudana"]),
    ("ramzan", ["ramzan", "ramadan", "iftar", "suhoor", "sehri", "roza"]),
    ("halal", ["halal"]),
    ("nutfree", ["peanut", "peanuts", "nut allergy", "nut free", "nut-free", "nuts"]),
    ("gluten", ["gluten", "celiac", "coeliac"]),
    ("diabetic", ["diabetic", "diabetes", "sugar"]),
    ("lowsodium", ["low sodium", "low-sodium", "low salt", "blood pressure", "bp"]),
    ("child", ["child", "kid", "baby", "toddler"]),
    ("nonveg", ["non-veg", "non veg", "nonveg", "chicken", "mutton", "meat", "egg", "eggs"]),
    ("sattvik", ["sattvik", "satvik", "no onion", "no garlic", "without onion", "without garlic"]),
    ("veg", ["veg", "vegetarian", "paneer"]),
]


def guess_meal(text):
    lowered = text.lower()
    for code, words in KEYWORDS:
        for word in words:
            if re.search(rf"\b{re.escape(word)}\b", lowered):
                return code
    return None


def handle_text(conn, pnr, text, flight, now, meals, festivals):
    text = text.strip()[:300]
    if not text:
        return
    send(conn, pnr, "in", text)
    locked = now >= flight["cutoff"]
    people = _people(conn, pnr)
    allowed = {m["code"]: m for m in meals}
    start_button = {"buttons": [{"label": "Request meal change" if locked else "Choose meal", "payload": "start"}]}
    code = guess_meal(text)
    if code is None:
        lead = "Normal meal changes are closed. " if locked else ""
        return _reply(conn, pnr, lead + "Sorry, I could not identify a meal. "
                                 "Tap the button to see available options.", start_button)
    if code not in allowed:
        return _reply(conn, pnr, "We do not have that meal on your flight date. "
                                 "Tap the button to see available options.", start_button)

    meal = allowed[code]
    lowered = text.lower()
    named = [p for p in people if re.search(rf"\b{re.escape(p['first_name'].lower())}\b", lowered)]
    if len(named) == 1:
        target = named[0]
    elif len(people) == 1:
        target = people[0]
    else:
        target = None

    if target is not None:
        if locked:
            return _late_request(conn, pnr, target, meal, now)
        return _save_and_confirm(conn, pnr, target, meal, people, flight, now)
    buttons = [{"label": p["first_name"], "payload": f"assign:{p['id']}:{code}"} for p in people]
    prefix = "This will be a late request for crew approval. " if locked else ""
    _reply(conn, pnr, prefix + f"Got it: *{meal['name']}*. Who is this meal for?", {"buttons": buttons})
