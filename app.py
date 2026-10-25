"""SkyBite web app: passenger site and airline staff site, one database.

Run with:  python app.py   then open http://localhost:5000
"""
import json
import math
import os
import secrets
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template, request,
                   session, url_for)
from werkzeug.security import check_password_hash

import chat
import db
import passenger_features as pf
import onflight
from chat import fmt_day, fmt_time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STANDARD_BUFFER_RATE = 0.05
FESTIVAL_BUFFER_RATE = 0.10


def _secret_key():
    """Use SECRET_KEY if set, otherwise keep one in a local file so logins survive restarts."""
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = os.path.join(BASE_DIR, ".secret_key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


app = Flask(__name__)
app.config["SECRET_KEY"] = _secret_key()
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)
app.config["DEMO_HINTS"] = True   # shows demo login details on the login pages; set False for the real pitch

db.init_db()


# --------------------------------------------------------------------------- database helpers

def get_db():
    if "db" not in g:
        g.db = db.connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def demo_now():
    row = get_db().execute("SELECT value FROM settings WHERE key = 'demo_now'").fetchone()
    return datetime.fromisoformat(row["value"])


def flight_from_conn(conn, flight_id=1):
    row = conn.execute("SELECT * FROM flights WHERE id = ?", (flight_id,)).fetchone()
    if row is None:
        abort(404)
    departs = datetime.fromisoformat(row["departs_at"])
    return {
        "id": row["id"], "number": row["number"], "origin": row["origin"],
        "origin_city": row["origin_city"], "dest": row["dest"], "dest_city": row["dest_city"],
        "rows": row["rows"], "departs": departs,
        "cutoff": departs - timedelta(hours=db.KITCHEN_CUTOFF_HOURS),
    }


def get_flight(flight_id=1):
    return flight_from_conn(get_db(), flight_id)


def active_festivals(on_date):
    day = on_date.date().isoformat()
    return get_db().execute(
        "SELECT * FROM festivals WHERE start_date <= ? AND end_date >= ?", (day, day)).fetchall()


def meals_for_flight(flight):
    """Meals a passenger can pick: everyday meals, plus festival meals only if the flight date has a festival."""
    festivals = active_festivals(flight["departs"])
    festival_codes = set()
    for f in festivals:
        festival_codes.update(code.strip() for code in f["meal_codes"].split(",") if code.strip())
    meals = [m for m in get_db().execute("SELECT * FROM meals ORDER BY sort").fetchall()
             if not m["festival_only"] or m["code"] in festival_codes]
    return meals, festivals


def allocate_whole_units(total, weights):
    """Allocate an integer total by weights using the largest-remainder method.

    This keeps table row allocations consistent with the displayed flight-wide totals; it
    avoids repeatedly rounding every meal row up and accidentally inflating the buffer.
    """
    result = {key: 0 for key in weights}
    positive = {key: max(0.0, float(weight)) for key, weight in weights.items()}
    weight_total = sum(positive.values())
    if total <= 0 or weight_total <= 0:
        return result

    exact = {key: total * weight / weight_total for key, weight in positive.items()}
    for key, value in exact.items():
        result[key] = math.floor(value)
    remaining = total - sum(result.values())
    priority = sorted(
        positive,
        key=lambda key: (-(exact[key] - result[key]), str(key)),
    )
    for key in priority[:remaining]:
        result[key] += 1
    return result


def historical_mix(conn, route, festival_name=None):
    """Return per-meal counts, flight count and selected-meal total for a reference set."""
    if festival_name:
        condition = "lower(COALESCE(festival_name, '')) = lower(?)"
        params = [festival_name]
    else:
        condition = "(festival_name IS NULL OR trim(festival_name) = '')"
        params = []

    route_clause = "route = ? AND "
    rows = conn.execute(
        "SELECT meal_code, SUM(meal_count) AS n FROM historical_meal_counts WHERE "
        + route_clause + condition + " GROUP BY meal_code",
        [route, *params],
    ).fetchall()
    flight_count = conn.execute(
        "SELECT COUNT(DISTINCT flight_number) AS n FROM historical_meal_counts WHERE "
        + route_clause + condition,
        [route, *params],
    ).fetchone()["n"]

    # If a route has no history, fall back to the same historical group across routes.
    if not rows or not sum(int(row["n"] or 0) for row in rows):
        rows = conn.execute(
            "SELECT meal_code, SUM(meal_count) AS n FROM historical_meal_counts WHERE "
            + condition + " GROUP BY meal_code",
            params,
        ).fetchall()
        flight_count = conn.execute(
            "SELECT COUNT(DISTINCT flight_number) AS n FROM historical_meal_counts WHERE "
            + condition,
            params,
        ).fetchone()["n"]

    counts = {row["meal_code"]: int(row["n"] or 0) for row in rows}
    return counts, int(flight_count or 0), sum(counts.values())


def forecast_stock_plan(conn, flight):
    """Calculate the recommended total load by meal using the same rules as Demand Forecast.

    This is a demo planning snapshot, not a live physical inventory feed. At the first late
    request after cutoff it is frozen in late_meal_stock so subsequent approvals consume the
    same plan instead of making available stock grow when the forecast recalculates.
    """
    day = flight["departs"].date().isoformat()
    festivals = conn.execute(
        "SELECT * FROM festivals WHERE start_date <= ? AND end_date >= ?", (day, day)
    ).fetchall()
    festival_codes = set()
    for festival in festivals:
        festival_codes.update(code.strip() for code in festival["meal_codes"].split(",") if code.strip())
    catalog = conn.execute("SELECT * FROM meals ORDER BY sort").fetchall()
    allowed = [m for m in catalog if not m["festival_only"] or m["code"] in festival_codes]
    available_codes = [m["code"] for m in allowed]

    counts = {
        row["code"]: int(row["n"] or 0)
        for row in conn.execute(
            "SELECT m.code, COUNT(p.id) AS n FROM meals m LEFT JOIN passengers p ON p.meal_code = m.code GROUP BY m.code"
        ).fetchall()
    }
    not_chosen = int(conn.execute(
        "SELECT COUNT(*) FROM passengers WHERE flight_id = ? AND meal_code IS NULL", (flight["id"],)
    ).fetchone()[0])
    route = f"{flight['origin']}-{flight['dest']}"
    regular_history, regular_flights, regular_total = historical_mix(conn, route, None)
    festival_name = festivals[0]["name"] if festivals else None
    if festival_name:
        context_history, context_flights, context_total = historical_mix(conn, route, festival_name)
        if not context_flights or not context_total:
            context_history, context_flights, context_total = regular_history, regular_flights, regular_total
    else:
        context_history, context_flights, context_total = regular_history, regular_flights, regular_total

    weights = {code: context_history.get(code, 0) for code in available_codes}
    if sum(weights.values()) <= 0:
        weights = {code: counts.get(code, 0) for code in available_codes}
    if sum(weights.values()) <= 0:
        weights = {code: 1 for code in available_codes}
    pending = allocate_whole_units(not_chosen, weights)
    expected = {code: counts.get(code, 0) + pending.get(code, 0) for code in available_codes}
    total_expected = sum(expected.values())
    standard_total = math.ceil(total_expected * STANDARD_BUFFER_RATE) if total_expected else 0
    seasonal_demand = sum(expected.get(code, 0) for code in available_codes if festivals and code in festival_codes)
    seasonal_total = math.ceil(seasonal_demand * FESTIVAL_BUFFER_RATE) if seasonal_demand else 0
    standard_alloc = allocate_whole_units(standard_total, expected)
    seasonal_alloc = allocate_whole_units(
        seasonal_total, {code: expected.get(code, 0) if code in festival_codes and festivals else 0 for code in available_codes}
    )
    return {
        code: expected.get(code, 0) + standard_alloc.get(code, 0) + seasonal_alloc.get(code, 0)
        for code in available_codes
    }


def ensure_late_stock_snapshot(conn, flight):
    """Freeze the forecast load once, on first use of the late-change workflow."""
    exists = conn.execute(
        "SELECT 1 FROM late_meal_stock WHERE flight_id = ? LIMIT 1", (flight["id"],)
    ).fetchone()
    if exists:
        return
    plan = forecast_stock_plan(conn, flight)
    row = conn.execute("SELECT value FROM settings WHERE key = 'demo_now'").fetchone()
    stamp = row["value"] if row else datetime.now().isoformat()
    conn.executemany(
        "INSERT OR IGNORE INTO late_meal_stock (flight_id, meal_code, planned_qty, snapshot_at) VALUES (?,?,?,?)",
        [(flight["id"], code, max(0, int(quantity)), stamp) for code, quantity in plan.items()],
    )


def late_stock_remaining(conn, flight_id, meal_code):
    """Unassigned demo stock after confirmed assignments and held alternative offers."""
    row = conn.execute(
        "SELECT planned_qty FROM late_meal_stock WHERE flight_id = ? AND meal_code = ?",
        (flight_id, meal_code),
    ).fetchone()
    if row is None:
        return 0
    assigned = int(conn.execute(
        "SELECT COUNT(*) FROM passengers WHERE flight_id = ? AND meal_code = ?", (flight_id, meal_code)
    ).fetchone()[0])
    reserved = int(conn.execute(
        """SELECT COUNT(*) FROM late_meal_requests lr
           JOIN passengers p ON p.id = lr.passenger_id
           WHERE lr.status = 'alternative_offered' AND lr.alternative_meal_code = ?
             AND p.flight_id = ? AND COALESCE(p.meal_code, '') != COALESCE(lr.alternative_meal_code, '')""",
        (meal_code, flight_id),
    ).fetchone()[0])
    return max(0, int(row["planned_qty"]) - assigned - reserved)


def historical_waste_avoidance_series(conn, route, festival_name, festival_codes, max_points=10):
    """Estimate potential overstock avoided on reference flights vs a flat 15% buffer.

    This is an illustrative planning comparison, not measured food waste. The seeded history
    contains meal selections only; there are no post-flight leftover or consumption records.
    """
    rows = conn.execute(
        """SELECT flight_number, flight_date, route, festival_name, meal_code, meal_count
           FROM historical_meal_counts WHERE route = ? ORDER BY flight_date, flight_number""",
        (route,),
    ).fetchall()
    if not rows:
        rows = conn.execute(
            """SELECT flight_number, flight_date, route, festival_name, meal_code, meal_count
               FROM historical_meal_counts ORDER BY flight_date, flight_number"""
        ).fetchall()

    festival_code_map = {}
    for festival in conn.execute("SELECT name, meal_codes FROM festivals").fetchall():
        festival_code_map[(festival["name"] or "").strip().lower()] = {
            code.strip() for code in (festival["meal_codes"] or "").split(",") if code.strip()
        }
    if festival_name and festival_codes:
        festival_code_map.setdefault(festival_name.strip().lower(), set()).update(festival_codes)

    flights = {}
    for row in rows:
        key = (row["flight_number"], row["flight_date"], row["route"], row["festival_name"])
        flight = flights.setdefault(key, {"meals": {}, "total": 0})
        count = int(row["meal_count"] or 0)
        flight["meals"][row["meal_code"]] = count
        flight["total"] += count

    history = []
    for (number, flight_date, flight_route, past_festival), values in sorted(
        flights.items(), key=lambda item: (item[0][1], item[0][0])
    ):
        total = values["total"]
        if total <= 0:
            continue
        flat_buffer = math.ceil(total * 0.15)
        standard_buffer = math.ceil(total * STANDARD_BUFFER_RATE)
        historical_festival_codes = festival_code_map.get((past_festival or "").strip().lower(), set())
        seasonal_demand = (
            sum(count for code, count in values["meals"].items() if code in historical_festival_codes)
            if past_festival and historical_festival_codes else 0
        )
        seasonal_buffer = math.ceil(seasonal_demand * FESTIVAL_BUFFER_RATE) if seasonal_demand else 0
        targeted_buffer = standard_buffer + seasonal_buffer
        avoided = max(0, flat_buffer - targeted_buffer)
        try:
            date_label = datetime.strptime(flight_date, "%Y-%m-%d").strftime("%b '%y")
        except (TypeError, ValueError):
            date_label = str(flight_date or "Past flight")
        history.append({
            "flight": number,
            "date": date_label,
            "total": total,
            "flat_buffer": flat_buffer,
            "targeted_buffer": targeted_buffer,
            "saved": avoided,
        })

    history = history[-max_points:]
    if not history:
        return [], [], 0, "M 0,0", "M 0,0 L 0,0 Z", 15

    chart_left, chart_right = 46.0, 794.0
    chart_top, chart_bottom = 26.0, 154.0
    chart_height = chart_bottom - chart_top
    max_saved = max(item["saved"] for item in history)
    chart_max = max(5, int(math.ceil(max_saved / 5.0) * 5))
    # Leave room above the line for a calm chart, while keeping axis labels round.
    if chart_max == max_saved:
        chart_max += 5
    chart_values = []
    count = len(history)
    for index, item in enumerate(history):
        x = chart_left if count == 1 else chart_left + index * (chart_right - chart_left) / (count - 1)
        y = chart_bottom - (item["saved"] / chart_max) * chart_height
        # Keep the tiny value label clear of the point even when it sits near the chart ceiling.
        label_y = y + 15 if y < chart_top + 18 else y - 10
        chart_values.append({**item, "x": round(x, 2), "y": round(y, 2),
                             "label_y": round(label_y, 2), "point_index": index})
    line_path = "M " + " L ".join(f"{p['x']},{p['y']}" for p in chart_values)
    area_path = (
        f"M {chart_values[0]['x']},{chart_bottom} L "
        + " L ".join(f"{p['x']},{p['y']}" for p in chart_values)
        + f" L {chart_values[-1]['x']},{chart_bottom} Z"
    )
    grid_values = []
    for value in range(0, chart_max + 1, 5):
        y = chart_bottom - (value / chart_max) * chart_height
        grid_values.append({"value": value, "y": round(y, 2)})
    return chart_values, grid_values, sum(item["saved"] for item in history), line_path, area_path, chart_max


# --------------------------------------------------------------------------- template helpers

def humanize(delta):
    total = int(delta.total_seconds())
    if total <= 0:
        return "now"
    days, rem = divmod(total, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    parts = []
    if days:
        parts.append(f"{days} day{'s' if days != 1 else ''}")
    if hours:
        parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if not days and minutes:
        parts.append(f"{minutes} min")
    return " ".join(parts) or "under a minute"


SOURCE_LABELS = {
    "booking": "Chosen when booking",
    "whatsapp": "Updated on WhatsApp",
    "website": "Updated on the website",
    "late_request": "Approved late change",
}


def csrf_token():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(24)
    return session["csrf"]


app.jinja_env.globals.update(
    csrf_token=csrf_token, fmt_day=fmt_day, fmt_time=fmt_time, humanize=humanize,
    source_labels=SOURCE_LABELS)


# The phone page has no login: it stands in for one passenger's own phone, so there is no
# signed-in session for a forged form to ride on. Everything else needs the CSRF token.
CSRF_EXEMPT = {"phone_act", "phone_text"}


@app.before_request
def check_csrf():
    if request.method == "POST" and request.endpoint not in CSRF_EXEMPT:
        sent = request.form.get("csrf_token", "")
        if not sent or not secrets.compare_digest(sent, session.get("csrf", "")):
            abort(400)


def has_passenger_session():
    """Passenger and crew identities can coexist in one browser session."""
    return bool(session.get("pnr") and session.get("pax_id"))


def has_crew_session():
    return bool(session.get("staff_id") and session.get("staff_name"))


@app.after_request
def no_store(resp):
    # Stops the browser back button from showing a dashboard after sign-out.
    if has_passenger_session() or has_crew_session():
        resp.headers["Cache-Control"] = "no-store"
    return resp


# --------------------------------------------------------------------------- role protection

def role_required(role):
    """Authorize each workspace independently; signing into one doesn't log out the other."""
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            authorized = has_passenger_session() if role == "passenger" else has_crew_session()
            if not authorized:
                return redirect(url_for("passenger_login") if role == "passenger" else url_for("staff_login"))
            return view(*args, **kwargs)
        return wrapper
    return decorator


def start_passenger_session(pnr, pax_id):
    # Keep any existing staff identity so passenger + crew tabs work together on the same browser.
    session.pop("role", None)  # remove the legacy single-role flag from earlier versions
    session["pnr"] = pnr
    session["pax_id"] = pax_id
    session.permanent = True
    csrf_token()  # preserve a token already used by the other open workspace tab


def start_crew_session(staff_id, staff_name):
    # Keep any existing passenger identity; the two workspaces use separate session keys.
    session.pop("role", None)
    session["staff_id"] = staff_id
    session["staff_name"] = staff_name
    session.permanent = True
    csrf_token()  # preserve a token already used by the other open workspace tab


# --------------------------------------------------------------------------- passenger site

@app.route("/", methods=["GET"])
def passenger_login():
    if has_passenger_session():
        return redirect(url_for("my_booking"))
    return render_template("passenger_login.html", error=None, pnr="", last_name="")


@app.post("/login")
def passenger_login_post():
    pnr = request.form.get("pnr", "").strip().upper()
    last_name = request.form.get("last_name", "").strip()
    row = get_db().execute(
        "SELECT id FROM passengers WHERE pnr = ? AND lower(last_name) = lower(?) ORDER BY id LIMIT 1",
        (pnr, last_name)).fetchone()
    if row is None:
        return render_template(
            "passenger_login.html", pnr=pnr, last_name=last_name,
            error="We could not find that booking. Check the 6-character PNR and the last name on the ticket."), 401
    start_passenger_session(pnr=pnr, pax_id=row["id"])
    return redirect(url_for("my_booking"))


@app.get("/my")
@role_required("passenger")
def my_booking():
    conn = get_db()
    flight = get_flight()
    now = demo_now()
    meals, festivals = meals_for_flight(flight)
    meal_by_code = {m["code"]: m for m in conn.execute("SELECT * FROM meals").fetchall()}
    people = conn.execute(
        "SELECT * FROM passengers WHERE pnr = ? ORDER BY seat", (session["pnr"],)).fetchall()
    late_rows = conn.execute(
        """SELECT lr.*, oldm.name AS old_meal_name, reqm.name AS requested_meal_name,
                  altm.name AS alternative_meal_name
           FROM late_meal_requests lr
           JOIN passengers p ON p.id = lr.passenger_id
           LEFT JOIN meals oldm ON oldm.code = lr.old_meal_code
           JOIN meals reqm ON reqm.code = lr.requested_meal_code
           LEFT JOIN meals altm ON altm.code = lr.alternative_meal_code
           WHERE p.pnr = ? ORDER BY lr.id DESC""", (session["pnr"],)
    ).fetchall()
    late_requests_by_pax = {}
    for late_row in late_rows:
        item = dict(late_row)
        for field in ("old", "requested", "alternative"):
            dish_code = item.get(field + "_dish_code")
            dish = pf.dish_by_code(dish_code)
            item[field + "_dish_name"] = dish["name"] if dish else None
        late_requests_by_pax.setdefault(item["passenger_id"], item)

    dish_by_pax = {}
    dish_rows = conn.execute(
        """SELECT p.id AS passenger_id, p.meal_code AS current_meal_code,
                  dc.meal_code AS choice_meal_code, dc.dish_code
           FROM passengers p LEFT JOIN passenger_dish_choices dc ON dc.passenger_id = p.id
           WHERE p.pnr = ?""", (session["pnr"],)
    ).fetchall()
    for row in dish_rows:
        dish = pf.dish_by_code(row["dish_code"])
        if dish and row["current_meal_code"] == row["choice_meal_code"] == dish["meal_code"]:
            dish_by_pax[row["passenger_id"]] = dish
    me = conn.execute("SELECT first_name FROM passengers WHERE id = ?", (session["pax_id"],)).fetchone()
    return render_template(
        "passenger_home.html", flight=flight, now=now, locked=now >= flight["cutoff"],
        meals=meals, festivals=festivals, meal_by_code=meal_by_code, people=people,
        late_requests_by_pax=late_requests_by_pax, dish_by_pax=dish_by_pax,
        dish_catalog=pf.dish_catalog_for_frontend(),
        first_name=me["first_name"], pnr=session["pnr"])


@app.get("/my/late-requests/status")
@role_required("passenger")
def passenger_late_requests_status():
    """Small poll endpoint so an open passenger page reflects crew decisions promptly."""
    conn = get_db()
    rows = conn.execute(
        """SELECT lr.passenger_id, lr.status
           FROM late_meal_requests lr
           JOIN (
             SELECT passenger_id, MAX(id) AS latest_id
             FROM late_meal_requests GROUP BY passenger_id
           ) latest ON latest.passenger_id = lr.passenger_id AND latest.latest_id = lr.id
           JOIN passengers p ON p.id = lr.passenger_id
           WHERE p.pnr = ?""", (session["pnr"],)
    ).fetchall()
    return jsonify(requests={str(row["passenger_id"]): row["status"] for row in rows})


@app.post("/my/meal")
@role_required("passenger")
def change_meal():
    conn = get_db()
    flight = get_flight()
    try:
        pax_id = int(request.form.get("pax_id", ""))
    except ValueError:
        abort(400)
    pax = conn.execute(
        "SELECT * FROM passengers WHERE id = ? AND pnr = ?", (pax_id, session["pnr"])).fetchone()
    if pax is None:
        abort(404)
    allowed, _ = meals_for_flight(flight)
    code = request.form.get("meal_code", "").strip()
    dish_code = request.form.get("dish_code", "").strip()
    if code not in {m["code"] for m in allowed}:
        flash("That meal is not available on your flight date.", "warn")
        return redirect(url_for("my_booking"))
    selected_dish = pf.dish_for_meal(code, dish_code)
    passenger_note = " ".join(request.form.get("passenger_note", "").split())[:160]
    if not selected_dish:
        flash("Choose a specific dish before confirming your meal.", "warn")
        return redirect(url_for("my_booking"))
    old_dish_code = pf.current_dish(conn, pax_id, pax["meal_code"])
    same_choice = code == pax["meal_code"] and dish_code == old_dish_code
    if same_choice and not passenger_note:
        flash("That dish is already confirmed for this traveller.", "warn")
        return redirect(url_for("my_booking"))
    stamp = demo_now().isoformat()
    if same_choice and passenger_note:
        # A service note is useful even when the passenger keeps the same dish.
        # Log it as a live activity event without treating it as a meal change.
        conn.execute(
            """INSERT INTO meal_events
               (passenger_id, old_meal, new_meal, source, at, old_dish_code, new_dish_code, note)
               VALUES (?,?,?,?,?,?,?,?)""",
            (pax_id, code, code, "website", stamp, dish_code, dish_code, passenger_note),
        )
        category_row = conn.execute("SELECT name FROM meals WHERE code = ?", (code,)).fetchone()
        category_name = category_row["name"] if category_row else code
        if chat.has_chat(conn, session["pnr"]):
            chat.send(conn, session["pnr"], "out",
                      f"Crew note received for {selected_dish['name']} ({category_name}): {passenger_note}. Your confirmed meal remains unchanged.",
                      kind="sync")
        conn.commit()
        flash("Your note was sent to the crew. Your confirmed meal remains unchanged.", "ok")
        return redirect(url_for("my_booking"))
    category_row = conn.execute("SELECT name FROM meals WHERE code = ?", (code,)).fetchone()
    category_name = category_row["name"] if category_row else code
    display_name = f"{selected_dish['name']} ({category_name})"

    if demo_now() >= flight["cutoff"]:
        active_request = conn.execute(
            "SELECT id FROM late_meal_requests WHERE passenger_id = ? AND status IN ('pending','alternative_offered') LIMIT 1",
            (pax_id,),
        ).fetchone()
        if active_request:
            flash("A late meal request is already being reviewed for this traveller.", "warn")
            return redirect(url_for("my_booking"))
        ensure_late_stock_snapshot(conn, flight)
        try:
            conn.execute(
                """INSERT INTO late_meal_requests
                   (passenger_id, old_meal_code, requested_meal_code, old_dish_code, requested_dish_code,
                    passenger_note, status, requested_at)
                   VALUES (?,?,?,?,?,?, 'pending', ?)""",
                (pax_id, pax["meal_code"], code, old_dish_code, dish_code, passenger_note, stamp),
            )
        except sqlite3.IntegrityError:
            conn.commit()
            flash("A late meal request is already being reviewed for this traveller.", "warn")
            return redirect(url_for("my_booking"))
        if chat.has_chat(conn, session["pnr"]):
            late_message = (f"Late meal change received: {pax['first_name']} requested *{selected_dish['name']}* ({category_name}). "
                            "The crew will review stock; the current meal stays confirmed.")
            if passenger_note:
                late_message += f"\nPassenger note for crew: {passenger_note}"
            chat.send(conn, session["pnr"], "out", late_message, kind="sync")
        conn.commit()
        flash(f"Late request sent for {pax['first_name']}: {display_name}. The current meal stays confirmed until crew review.", "ok")
        return redirect(url_for("my_booking"))

    conn.execute("UPDATE passengers SET meal_code = ?, meal_source = 'website', meal_updated_at = ? WHERE id = ?",
                 (code, stamp, pax_id))
    pf.save_current_dish(conn, pax_id, code, dish_code, stamp, source="website")
    conn.execute(
        """INSERT INTO meal_events (passenger_id, old_meal, new_meal, source, at, old_dish_code, new_dish_code, note)
           VALUES (?,?,?,?,?,?,?,?)""",
        (pax_id, pax["meal_code"], code, "website", stamp, old_dish_code, dish_code, passenger_note),
    )
    if chat.has_chat(conn, session["pnr"]):
        update_message = f"Update from the website: {pax['first_name']}'s meal is now *{selected_dish['name']}* ({category_name})."
        if passenger_note:
            update_message += f"\nPassenger note for crew: {passenger_note}"
        chat.send(conn, session["pnr"], "out", update_message, kind="sync")
    conn.commit()
    flash(f"{pax['first_name']}'s meal is now {selected_dish['name']} ({category_name}). The kitchen has been updated.", "ok")
    return redirect(url_for("my_booking"))


@app.post("/my/late-request/<int:request_id>/alternative")
@role_required("passenger")
def respond_late_alternative(request_id):
    conn = get_db()
    decision = request.form.get("decision", "").strip().lower()
    if decision not in {"accept", "decline"}:
        abort(400)
    late = conn.execute(
        """SELECT lr.*, p.pnr, p.flight_id, p.first_name, p.seat, p.meal_code AS current_meal_code,
                  alt.name AS alternative_name
           FROM late_meal_requests lr JOIN passengers p ON p.id = lr.passenger_id
           LEFT JOIN meals alt ON alt.code = lr.alternative_meal_code
           WHERE lr.id = ? AND p.pnr = ?""", (request_id, session["pnr"])
    ).fetchone()
    if late is None:
        abort(404)
    if late["status"] != "alternative_offered":
        flash("That alternative is no longer awaiting a response.", "warn")
        return redirect(url_for("my_booking"))
    stamp = demo_now().isoformat()
    alternative_dish = pf.dish_by_code(late["alternative_dish_code"])
    alt_dish_name = alternative_dish["name"] if alternative_dish else late["alternative_name"]
    if decision == "accept":
        old_dish_code = pf.current_dish(conn, late["passenger_id"], late["current_meal_code"])
        conn.execute(
            "UPDATE passengers SET meal_code = ?, meal_source = 'late_request', meal_updated_at = ? WHERE id = ?",
            (late["alternative_meal_code"], stamp, late["passenger_id"]),
        )
        pf.save_current_dish(conn, late["passenger_id"], late["alternative_meal_code"],
                             late["alternative_dish_code"], stamp, source="late_request")
        conn.execute(
            """INSERT INTO meal_events (passenger_id, old_meal, new_meal, source, at, old_dish_code, new_dish_code, note)
               VALUES (?,?,?,?,?,?,?,?)""",
            (late["passenger_id"], late["current_meal_code"], late["alternative_meal_code"],
             "late_request", stamp, old_dish_code, late["alternative_dish_code"], late["passenger_note"] or ""),
        )
        note = (late["decision_note"] or "Alternative offered by crew.") + " Passenger accepted the alternative."
        conn.execute("UPDATE late_meal_requests SET status = 'alternative_accepted', decision_note = ? WHERE id = ?",
                     (note[:500], request_id))
        if chat.has_chat(conn, late["pnr"]):
            chat.send(conn, late["pnr"], "out",
                      f"Confirmed: {late['first_name']}'s meal is now *{alt_dish_name}* ({late['alternative_name']}) after accepting the crew's alternative.", kind="sync")
        flash(f"Alternative accepted. {late['first_name']}'s meal is now {alt_dish_name}.", "ok")
    else:
        note = (late["decision_note"] or "Alternative offered by crew.") + " Passenger declined the alternative; no meal change was made."
        conn.execute("UPDATE late_meal_requests SET status = 'alternative_declined', decision_note = ? WHERE id = ?",
                     (note[:500], request_id))
        if chat.has_chat(conn, late["pnr"]):
            chat.send(conn, late["pnr"], "out",
                      f"The alternative *{alt_dish_name}* for {late['first_name']}'s meal was declined. The existing meal choice has not changed.", kind="sync")
        flash("Alternative declined. No meal change was made.", "warn")
    conn.commit()
    return redirect(url_for("my_booking"))


# --------------------------------------------------------------------------- staff site

@app.get("/staff")
def staff_login():
    if has_crew_session():
        return redirect(url_for("crew_home"))
    return render_template("staff_login.html", error=None, staff_id="")


@app.post("/staff")
def staff_login_post():
    staff_id = request.form.get("staff_id", "").strip().upper()
    password = request.form.get("password", "")
    row = get_db().execute("SELECT * FROM crew WHERE staff_id = ?", (staff_id,)).fetchone()
    if row is None or not check_password_hash(row["password_hash"], password):
        return render_template("staff_login.html", staff_id=staff_id,
                               error="Staff ID or password is not right."), 401
    start_crew_session(staff_id=row["staff_id"], staff_name=row["name"])
    return redirect(url_for("crew_home"))


@app.get("/crew")
@role_required("crew")
def crew_home():
    conn = get_db()
    flight = get_flight()
    now = demo_now()
    rows = conn.execute(
        """SELECT m.code, m.name, m.color, COUNT(p.id) AS n
           FROM meals m LEFT JOIN passengers p ON p.meal_code = m.code
           GROUP BY m.code HAVING n > 0 ORDER BY n DESC""").fetchall()
    not_chosen = conn.execute("SELECT COUNT(*) FROM passengers WHERE meal_code IS NULL").fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM passengers").fetchone()[0]
    changes = conn.execute("SELECT COUNT(*) FROM meal_events WHERE source = 'website'").fetchone()[0]
    wa_choices = conn.execute("SELECT COUNT(*) FROM meal_events WHERE source = 'whatsapp'").fetchone()[0]
    reminders_sent = conn.execute("SELECT COUNT(*) FROM messages WHERE kind = 'reminder48'").fetchone()[0]
    reminders_6_sent = conn.execute("SELECT COUNT(*) FROM messages WHERE kind = 'reminder6'").fetchone()[0]
    cutoff_notices_sent = conn.execute("SELECT COUNT(*) FROM messages WHERE kind = 'reminder4'").fetchone()[0]
    biggest = max([r["n"] for r in rows] + [not_chosen, 1])
    festivals = active_festivals(flight["departs"])

    # Forecast demand from the current selection counts plus a history-weighted estimate for
    # undecided passengers. Historical figures are seeded sample data for this hackathon demo;
    # the UI labels them as samples because the original project had no past-flight records.
    meals, _ = meals_for_flight(flight)
    festival_codes = set()
    for festival in festivals:
        festival_codes.update(
            code.strip() for code in festival["meal_codes"].split(",") if code.strip()
        )
    forecast_counts = {
        r["code"]: int(r["n"])
        for r in conn.execute(
            """SELECT m.code, COUNT(p.id) AS n
               FROM meals m LEFT JOIN passengers p ON p.meal_code = m.code
               GROUP BY m.code"""
        ).fetchall()
    }

    route_code = f"{flight['origin']}-{flight['dest']}"
    regular_history, forecast_regular_flights, regular_history_total = historical_mix(
        conn, route_code, None
    )
    active_festival_name = festivals[0]["name"] if festivals else None
    if active_festival_name:
        context_history, context_flights, context_history_total = historical_mix(
            conn, route_code, active_festival_name
        )
        history_fallback = context_flights == 0 or context_history_total == 0
        if history_fallback:
            context_history = regular_history
            context_flights = forecast_regular_flights
            context_history_total = regular_history_total
    else:
        context_history = regular_history
        context_flights = forecast_regular_flights
        context_history_total = regular_history_total
        history_fallback = False

    available_codes = [meal["code"] for meal in meals]
    pending_weights = {
        code: context_history.get(code, 0)
        for code in available_codes
    }
    if sum(pending_weights.values()) <= 0:
        pending_weights = {code: forecast_counts.get(code, 0) for code in available_codes}
    if sum(pending_weights.values()) <= 0:
        pending_weights = {code: 1 for code in available_codes}
    pending_allocations = allocate_whole_units(not_chosen, pending_weights)

    # A single 5% flight-wide standard buffer is allocated across meal rows, rather than
    # rounding each row up. Active-festival options also receive a 10% targeted contingency.
    meal_catalog = conn.execute("SELECT code, name, color FROM meals ORDER BY sort").fetchall()
    forecast_rows = []
    for meal in meal_catalog:
        code = meal["code"]
        confirmed = forecast_counts.get(code, 0)
        expected_from_pending = pending_allocations.get(code, 0)
        expected = confirmed + expected_from_pending
        seasonal = code in festival_codes and bool(festivals)
        history_share = (
            100.0 * context_history.get(code, 0) / context_history_total
            if context_history_total else 0.0
        )
        if confirmed or expected_from_pending or seasonal:
            forecast_rows.append({
                "code": code,
                "name": meal["name"],
                "color": meal["color"],
                "confirmed": confirmed,
                "from_pending": expected_from_pending,
                "expected": expected,
                "history_share": round(history_share, 1),
                "seasonal": seasonal,
                "base_buffer": 0,
                "seasonal_buffer": 0,
                "buffer": 0,
                "stock": expected,
            })

    expected_demand_total = sum(row["expected"] for row in forecast_rows)
    # Compute buffer totals once, so row allocations sum exactly to the displayed total.
    standard_buffer_total = math.ceil(expected_demand_total * STANDARD_BUFFER_RATE) if expected_demand_total else 0
    seasonal_demand_total = sum(row["expected"] for row in forecast_rows if row["seasonal"])
    seasonal_buffer_total = (
        math.ceil(seasonal_demand_total * FESTIVAL_BUFFER_RATE)
        if festivals and seasonal_demand_total else 0
    )
    standard_allocations = allocate_whole_units(
        standard_buffer_total, {row["code"]: row["expected"] for row in forecast_rows}
    )
    seasonal_allocations = allocate_whole_units(
        seasonal_buffer_total,
        {row["code"]: row["expected"] if row["seasonal"] else 0 for row in forecast_rows},
    )

    for row in forecast_rows:
        row["base_buffer"] = standard_allocations.get(row["code"], 0)
        row["seasonal_buffer"] = seasonal_allocations.get(row["code"], 0)
        row["buffer"] = row["base_buffer"] + row["seasonal_buffer"]
        row["stock"] = row["expected"] + row["buffer"]

    # Seasonal options are easiest for crew to scan first; other rows are ranked by demand.
    forecast_rows.sort(key=lambda row: (not row["seasonal"], -row["expected"], row["name"]))
    forecast_confirmed = sum(row["confirmed"] for row in forecast_rows)
    forecast_from_pending = sum(row["from_pending"] for row in forecast_rows)
    forecast_buffer = sum(row["buffer"] for row in forecast_rows)
    forecast_stock = sum(row["stock"] for row in forecast_rows)
    forecast_demand = sum(row["expected"] for row in forecast_rows)
    service_feedback = onflight.service_feedback_summary(conn, flight["id"], forecast_buffer)
    mode_row = conn.execute("SELECT on_flight_mode FROM flight_operations WHERE flight_id = ?", (flight["id"],)).fetchone()
    on_flight_mode = bool(mode_row and mode_row["on_flight_mode"])

    regular_aligned_share = (
        100.0 * sum(regular_history.get(code, 0) for code in festival_codes) / regular_history_total
        if festivals and regular_history_total else 0.0
    )
    context_aligned_share = (
        100.0 * sum(context_history.get(code, 0) for code in festival_codes) / context_history_total
        if festivals and context_history_total else 0.0
    )
    forecast_history_label = (
        f"{context_flights} regular-flight references (festival history unavailable)"
        if festivals and history_fallback
        else (f"{context_flights} previous {active_festival_name} sample flights"
              if active_festival_name
              else f"{context_flights} previous regular-flight sample flights")
    )

    (forecast_waste_history, forecast_waste_grid, forecast_waste_total,
     forecast_waste_line_path, forecast_waste_area_path, forecast_waste_chart_max) = (
        historical_waste_avoidance_series(
            conn, route_code, active_festival_name, festival_codes, max_points=10
        )
    )

    return render_template(
        "crew_home.html", flight=flight, now=now, locked=now >= flight["cutoff"], rows=rows,
        not_chosen=not_chosen, total=total, changes=changes, biggest=biggest,
        seats=flight["rows"] * 6, festivals=festivals, staff_name=session["staff_name"],
        wa_choices=wa_choices, reminders_sent=reminders_sent,
        reminders_6_sent=reminders_6_sent, cutoff_notices_sent=cutoff_notices_sent,
        forty_eight_hour_mark=flight["departs"] - timedelta(hours=48),
        six_hour_mark=flight["departs"] - timedelta(hours=6),
        forecast_rows=forecast_rows, forecast_confirmed=forecast_confirmed,
        forecast_from_pending=forecast_from_pending, forecast_demand=forecast_demand,
        forecast_buffer=forecast_buffer, forecast_stock=forecast_stock,
        service_feedback=service_feedback, on_flight_mode=on_flight_mode,
        forecast_standard_buffer=standard_buffer_total,
        forecast_seasonal_buffer=seasonal_buffer_total,
        forecast_history_label=forecast_history_label,
        forecast_history_flights=context_flights,
        forecast_regular_flights=forecast_regular_flights,
        forecast_history_fallback=history_fallback,
        forecast_context_share=round(context_aligned_share, 1),
        forecast_regular_share=round(regular_aligned_share, 1),
        forecast_uplift=round(round(context_aligned_share, 1) - round(regular_aligned_share, 1), 1),
        forecast_history_is_sample=True,
        forecast_waste_history=forecast_waste_history,
        forecast_waste_grid=forecast_waste_grid,
        forecast_waste_total=forecast_waste_total,
        forecast_waste_line_path=forecast_waste_line_path,
        forecast_waste_area_path=forecast_waste_area_path,
        forecast_waste_chart_max=forecast_waste_chart_max,
    )

@app.post("/crew/late-request/<int:request_id>")
@role_required("crew")
def decide_late_meal_request(request_id):
    conn = get_db()
    flight = get_flight()
    late = conn.execute(
        """SELECT lr.*, p.first_name, p.last_name, p.seat, p.pnr, p.flight_id,
                  p.meal_code AS current_meal_code, oldm.name AS old_name, reqm.name AS requested_name
           FROM late_meal_requests lr JOIN passengers p ON p.id = lr.passenger_id
           LEFT JOIN meals oldm ON oldm.code = lr.old_meal_code
           JOIN meals reqm ON reqm.code = lr.requested_meal_code
           WHERE lr.id = ? AND p.flight_id = ?""", (request_id, flight["id"])
    ).fetchone()
    if late is None:
        return jsonify(ok=False, message="This late request could not be found."), 404
    if late["status"] != "pending":
        return jsonify(ok=False, message="This request is no longer waiting for a crew decision."), 409

    action = request.form.get("action", "").strip().lower()
    stamp = demo_now().isoformat()
    staff_name = session.get("staff_name", "Crew")
    passenger_name = f"{late['first_name']} {late['last_name']}"
    requested_dish = pf.dish_by_code(late["requested_dish_code"])
    requested_dish_name = requested_dish["name"] if requested_dish else late["requested_name"]
    old_dish_code = pf.current_dish(conn, late["passenger_id"], late["current_meal_code"])
    same_category = late["current_meal_code"] == late["requested_meal_code"]

    if action == "approve":
        if not same_category:
            ensure_late_stock_snapshot(conn, flight)
            conn.commit()
            available = late_stock_remaining(conn, flight["id"], late["requested_meal_code"])
            if available < 1:
                return jsonify(ok=False, message=f"No unassigned planned stock remains for {late['requested_name']}. Offer a stocked dish alternative or decline the request."), 409
        conn.execute(
            "UPDATE passengers SET meal_code = ?, meal_source = 'late_request', meal_updated_at = ? WHERE id = ?",
            (late["requested_meal_code"], stamp, late["passenger_id"]),
        )
        pf.save_current_dish(conn, late["passenger_id"], late["requested_meal_code"],
                             late["requested_dish_code"], stamp, source="late_request")
        conn.execute(
            """INSERT INTO meal_events (passenger_id, old_meal, new_meal, source, at, old_dish_code, new_dish_code, note)
               VALUES (?,?,?,?,?,?,?,?)""",
            (late["passenger_id"], late["current_meal_code"], late["requested_meal_code"],
             "late_request", stamp, old_dish_code, late["requested_dish_code"], late["passenger_note"] or ""),
        )
        allocation_note = "dish substitution within the existing meal category" if same_category else "one unit allocated from planned category stock"
        note = f"Approved by {staff_name}; {allocation_note}."
        conn.execute(
            "UPDATE late_meal_requests SET status = 'approved', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ? AND status = 'pending'",
            (stamp, staff_name, note, request_id),
        )
        message = f"Approved {passenger_name}'s late change to {requested_dish_name} ({late['requested_name']})."
        if chat.has_chat(conn, late["pnr"]):
            chat.send(conn, late["pnr"], "out",
                      f"Good news: {late['first_name']}'s late meal change is approved. The confirmed dish is now *{requested_dish_name}* ({late['requested_name']}).", kind="sync")

    elif action == "decline":
        reason = request.form.get("reason", "").strip()[:250]
        if not reason:
            return jsonify(ok=False, message="Add a short reason before declining this request."), 400
        conn.execute(
            "UPDATE late_meal_requests SET status = 'declined', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ? AND status = 'pending'",
            (stamp, staff_name, reason, request_id),
        )
        message = f"Declined {passenger_name}'s request for {requested_dish_name}. The original meal remains unchanged."
        if chat.has_chat(conn, late["pnr"]):
            chat.send(conn, late["pnr"], "out",
                      f"Your late request for *{requested_dish_name}* ({late['requested_name']}) could not be approved: {reason}. Your existing meal remains confirmed.", kind="sync")

    elif action == "alternative":
        alternative_dish_code = request.form.get("alternative_dish_code", "").strip()
        # Accept category values from old clients during a hot reload, but always persist a dish.
        if alternative_dish_code in pf.DISH_CATALOG:
            alternative_dish_code = pf.default_dish(alternative_dish_code)
        alternative_dish = pf.dish_by_code(alternative_dish_code)
        alternative_code = pf.DISH_TO_MEAL.get(alternative_dish_code)
        if not alternative_dish or not alternative_code:
            return jsonify(ok=False, message="Choose a specific available dish alternative."), 400
        if alternative_dish_code in {late["requested_dish_code"], old_dish_code}:
            return jsonify(ok=False, message="Choose a different dish from the current or requested selection."), 400
        ensure_late_stock_snapshot(conn, flight)
        conn.commit()
        same_as_current_category = alternative_code == late["current_meal_code"]
        if not same_as_current_category:
            available = late_stock_remaining(conn, flight["id"], alternative_code)
            if available < 1:
                return jsonify(ok=False, message=f"No unassigned planned stock remains for {alternative_dish['name']}'s meal category. Choose another dish."), 409
        else:
            available = 0
        alternative = conn.execute("SELECT name FROM meals WHERE code = ?", (alternative_code,)).fetchone()
        if not alternative:
            return jsonify(ok=False, message="That dish is not on the flight menu."), 400
        note = f"{staff_name} offered {alternative_dish['name']} ({alternative['name']}); awaiting passenger response."
        conn.execute(
            """UPDATE late_meal_requests SET status = 'alternative_offered', alternative_meal_code = ?,
               alternative_dish_code = ?, decided_at = ?, decided_by = ?, decision_note = ?
               WHERE id = ? AND status = 'pending'""",
            (alternative_code, alternative_dish_code, stamp, staff_name, note, request_id),
        )
        message = f"Offered {alternative_dish['name']} ({alternative['name']}) to {passenger_name}; the passenger must confirm the alternative."
        if chat.has_chat(conn, late["pnr"]):
            chat.send(conn, late["pnr"], "out",
                      f"We couldn't confirm *{requested_dish_name}*. The crew can offer *{alternative_dish['name']}* ({alternative['name']}) instead. Please accept or decline this alternative on your SkyBite booking page.", kind="sync")
    else:
        return jsonify(ok=False, message="Choose approve, decline or offer an alternative."), 400

    conn.commit()
    return jsonify(ok=True, message=message, request_id=request_id, action=action)


@app.post("/crew/fast-forward")
@role_required("crew")
def fast_forward():
    """Demo stage 1: move to 48 hours before departure and message each booking once."""
    conn = get_db()
    flight = get_flight()
    target = flight["departs"] - timedelta(hours=48)
    current = demo_now()
    already = conn.execute("SELECT 1 FROM messages WHERE kind = 'reminder48' LIMIT 1").fetchone()
    if already:
        flash("The 48-hour WhatsApp reminder was already sent. Reset demo data to replay the timeline.", "warn")
        return redirect(url_for("crew_home"))
    if current > target:
        flash("The demo clock has passed the 48-hour mark. Reset demo data to replay this reminder at the right time.", "warn")
        return redirect(url_for("crew_home"))
    if current < target:
        conn.execute("UPDATE settings SET value = ? WHERE key = 'demo_now'", (target.isoformat(),))
    _, festivals = meals_for_flight(flight)
    sent = chat.send_reminders(conn, flight, festivals)
    conn.commit()
    flash(f"Clock moved to 48 hours before departure. WhatsApp meal reminder sent to {sent} bookings.", "ok")
    return redirect(url_for("crew_home"))


@app.post("/crew/fast-forward-six-hours")
@role_required("crew")
def fast_forward_six_hours():
    """Demo stage 2: send a last-call reminder six hours before departure."""
    conn = get_db()
    flight = get_flight()
    target = flight["departs"] - timedelta(hours=6)
    current = demo_now()
    already = conn.execute("SELECT 1 FROM messages WHERE kind = 'reminder6' LIMIT 1").fetchone()
    if already:
        flash("The six-hour WhatsApp reminder was already sent. Reset demo data to replay it.", "warn")
        return redirect(url_for("crew_home"))
    if current > target:
        flash("The demo clock has passed the six-hour reminder point. Reset the demo to replay the timeline in order.", "warn")
        return redirect(url_for("crew_home"))
    if current < target:
        conn.execute("UPDATE settings SET value = ? WHERE key = 'demo_now'", (target.isoformat(),))
    _, festivals = meals_for_flight(flight)
    sent = chat.send_six_hour_reminders(conn, flight, festivals)
    conn.commit()
    flash(f"Clock moved to 6 hours before departure. WhatsApp last-call reminder sent to {sent} bookings; meal selection closes in 2 hours.", "ok")
    return redirect(url_for("crew_home"))


@app.post("/crew/fast-forward-cutoff")
@role_required("crew")
def fast_forward_cutoff():
    """Demo stage 3: move to the four-hour deadline and notify passengers that changes are closed."""
    conn = get_db()
    flight = get_flight()
    target = flight["cutoff"]
    current = demo_now()
    already = conn.execute("SELECT 1 FROM messages WHERE kind = 'reminder4' LIMIT 1").fetchone()
    if current < target:
        conn.execute("UPDATE settings SET value = ? WHERE key = 'demo_now'", (target.isoformat(),))
    _, festivals = meals_for_flight(flight)
    sent = chat.send_cutoff_reminders(conn, flight)
    conn.commit()
    if current < target:
        flash(f"Clock moved to the 4-hour meal cutoff. Normal changes are now closed; a WhatsApp notice was sent to {sent} bookings.", "ok")
    elif already:
        flash("The demo clock is already at or past cutoff, and the closure notice was already sent.", "warn")
    else:
        flash(f"The demo clock is already at or past cutoff. A closure notice was sent to {sent} bookings.", "ok")
    return redirect(url_for("crew_home"))


@app.post("/crew/reset-demo")
@role_required("crew")
def reset_demo():
    db.reset_demo(get_db())
    flash("Demo reset. The clock, meals and messages are back at the start.", "ok")
    return redirect(url_for("crew_home"))


# --------------------------------------------------------------------------- WhatsApp phone page
# A separate page for a second phone. It is not part of either website: no login, and it only ever
# shows the one demo booking's chat.

@app.get("/whatsapp")
def phone():
    return render_template("phone.html")


@app.get("/whatsapp/messages")
def phone_messages():
    after = request.args.get("after", 0, type=int)
    conn = get_db()
    rows = conn.execute("SELECT * FROM messages WHERE pnr = ? AND id > ? ORDER BY id",
                        (db.DEMO_PNR, after)).fetchall()
    max_id = conn.execute("SELECT COALESCE(MAX(id), 0) FROM messages WHERE pnr = ?",
                          (db.DEMO_PNR,)).fetchone()[0]
    messages = []
    for r in rows:
        sent = datetime.fromisoformat(r["sent_at"])
        messages.append({
            "id": r["id"], "direction": r["direction"], "body": r["body"],
            "actions": json.loads(r["actions"]) if r["actions"] else None,
            "time": sent.strftime("%I:%M %p").lstrip("0").lower(),
            "day": sent.date().isoformat(),
        })
    # "today" comes from the server so the phone and the laptop never disagree about the date
    resp = jsonify(messages=messages, max_id=max_id, today=datetime.now().date().isoformat())
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.post("/whatsapp/act")
def phone_act():
    conn = get_db()
    if not chat.has_chat(conn, db.DEMO_PNR):
        return jsonify(ok=False), 409
    flight = get_flight()
    meals, festivals = meals_for_flight(flight)
    now = demo_now()
    payload = request.form.get("payload", "")[:60]
    # Freeze the forecast-based demo stock the first time a post-cutoff meal request is made.
    # Without this snapshot, the WhatsApp flow would create requests against an uninitialised plan.
    if now >= flight["cutoff"] and payload.partition(":")[0] in {"meal", "assign"}:
        ensure_late_stock_snapshot(conn, flight)
    chat.handle_action(conn, db.DEMO_PNR, payload, flight, now, meals, festivals)
    pf.reconcile_current_dishes(conn, source="whatsapp", stamp=now.isoformat())
    conn.commit()
    return jsonify(ok=True)


@app.post("/whatsapp/text")
def phone_text():
    conn = get_db()
    if not chat.has_chat(conn, db.DEMO_PNR):
        return jsonify(ok=False), 409
    flight = get_flight()
    meals, festivals = meals_for_flight(flight)
    now = demo_now()
    text = request.form.get("text", "")
    if now >= flight["cutoff"] and chat.guess_meal(text) in {m["code"] for m in meals}:
        ensure_late_stock_snapshot(conn, flight)
    chat.handle_text(conn, db.DEMO_PNR, text, flight, now, meals, festivals)
    pf.reconcile_current_dishes(conn, source="whatsapp", stamp=now.isoformat())
    conn.commit()
    return jsonify(ok=True)


# --------------------------------------------------------------------------- shared

@app.post("/logout")
def logout():
    logout_role = request.form.get("logout_role") or session.get("role", "passenger")
    if logout_role == "crew":
        session.pop("staff_id", None)
        session.pop("staff_name", None)
        if session.get("role") == "crew":
            session.pop("role", None)
        remaining = has_passenger_session()
        if not remaining:
            session.clear()
        return redirect(url_for("staff_login"))

    session.pop("pnr", None)
    session.pop("pax_id", None)
    if session.get("role") == "passenger":
        session.pop("role", None)
    remaining = has_crew_session()
    if not remaining:
        session.clear()
    return redirect(url_for("passenger_login"))


ERRORS = {
    400: ("Something went wrong with that form", "Go back, refresh the page and try again."),
    403: ("This area is for airline staff", "Your booking does not give you access to this page."),
    404: ("We could not find that page", "Check the address, or go back to your booking."),
}


def _error(code):
    def handler(_e):
        title, text = ERRORS[code]
        crew_only = has_crew_session() and not has_passenger_session()
        if code == 403 and crew_only:
            title, text = "This area is for passengers", "Staff accounts cannot open passenger pages."
        home_endpoint = "crew_home" if has_crew_session() else ("my_booking" if has_passenger_session() else "passenger_login")
        return render_template("error.html", code=code, title=title, text=text,
                               home=url_for(home_endpoint)), code
    return handler


for _code in ERRORS:
    app.register_error_handler(_code, _error(_code))


# Live Activity uses these request-local database helpers to show the same frozen plan
# and calculate currently unassigned demo stock without duplicating forecast arithmetic.
app.extensions["skybite_flight_from_conn"] = flight_from_conn
app.extensions["skybite_late_stock_remaining"] = late_stock_remaining
app.extensions["skybite_forecast_stock_plan"] = forecast_stock_plan
pf.init_app(app)                         # passenger language and specific-dish selection
import seatmap; seatmap.init_app(app)   # seat map feature (one line)
import live; live.init_app(app)         # live crew updates (one line)
onflight.init_app(app)                  # onboard service tracking + meal exchange


if __name__ == "__main__":
    # host 0.0.0.0 lets a phone on the same Wi-Fi open the site at http://<laptop-ip>:5000
    app.run(host="0.0.0.0", port=5000, debug=True)
