"""Live crew dashboard data, including dish-level meal counts and late requests."""
from datetime import datetime

from flask import Blueprint, current_app, jsonify, redirect, session, url_for

import db
import passenger_features as pf
from chat import fmt_day, fmt_time

bp = Blueprint("lv", __name__)


def _crew_only(view):
    """Require the crew identity; passenger and crew identities may share a browser session."""
    def wrapper(*args, **kwargs):
        if not (session.get("staff_id") and session.get("staff_name")):
            return redirect(url_for("staff_login"))
        return view(*args, **kwargs)
    wrapper.__name__ = view.__name__
    return wrapper


SOURCES = {"whatsapp": "WhatsApp", "website": "Website", "late_request": "Late change", "booking": "Booking"}


def _stamp(iso):
    try:
        dt = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return ""
    return f"{fmt_day(dt)}, {fmt_time(dt)}"


def _dish_display(dish_code, category_name):
    """Keep category first so crew sees the catering class and exact product together."""
    dish = pf.dish_by_code(dish_code)
    if dish and category_name:
        return f"{category_name} → {dish['name']}"
    return dish["name"] if dish else (category_name or "Meal not selected")


@bp.get("/crew/live/data")
@_crew_only
def data():
    conn = db.connect()
    try:
        rows = conn.execute(
            """SELECT m.code, m.name, m.color, COUNT(p.id) AS n
               FROM meals m LEFT JOIN passengers p ON p.meal_code = m.code
               GROUP BY m.code HAVING n > 0 ORDER BY n DESC""").fetchall()
        total = conn.execute("SELECT COUNT(*) FROM passengers").fetchone()[0]
        not_chosen = conn.execute("SELECT COUNT(*) FROM passengers WHERE meal_code IS NULL").fetchone()[0]
        website = conn.execute("SELECT COUNT(*) FROM meal_events WHERE source = 'website'").fetchone()[0]
        whatsapp = conn.execute("SELECT COUNT(*) FROM meal_events WHERE source = 'whatsapp'").fetchone()[0]
        meal_names = {row["code"]: row["name"] for row in conn.execute("SELECT code, name FROM meals")}

        # Group by exact selected dish inside the existing broad meal category.
        # The fallback is only for legacy/category-only records; it does not alter the passenger's category.
        grouped_dishes = {}
        dish_rows = conn.execute(
            """SELECT p.meal_code, dc.dish_code, COUNT(p.id) AS n
               FROM passengers p
               LEFT JOIN passenger_dish_choices dc
                 ON dc.passenger_id = p.id AND dc.meal_code = p.meal_code
               WHERE p.meal_code IS NOT NULL
               GROUP BY p.meal_code, dc.dish_code"""
        ).fetchall()
        for dish_row in dish_rows:
            category = dish_row["meal_code"]
            dish_code = dish_row["dish_code"] or pf.default_dish(category)
            dish = pf.dish_by_code(dish_code)
            if not dish:
                continue
            key = (category, dish_code)
            if key not in grouped_dishes:
                grouped_dishes[key] = {
                    "code": dish_code,
                    "name": dish["name"],
                    "meal_code": category,
                    "meal_name": meal_names.get(category, category),
                    "n": 0,
                }
            grouped_dishes[key]["n"] += dish_row["n"]
        dishes_by_meal = {}
        for (category, _dish_code), item in grouped_dishes.items():
            dishes_by_meal.setdefault(category, []).append(item)
        for items in dishes_by_meal.values():
            items.sort(key=lambda item: (-item["n"], item["name"].casefold()))

        events = conn.execute(
            """SELECT e.id, e.source, e.at, e.old_meal, e.new_meal, e.note,
                      e.old_dish_code, e.new_dish_code,
                      p.first_name, p.last_name, p.seat,
                      mn.name AS new_name, mn.color AS color, mo.name AS old_name
               FROM meal_events e
               JOIN passengers p ON p.id = e.passenger_id
               JOIN meals mn ON mn.code = e.new_meal
               LEFT JOIN meals mo ON mo.code = e.old_meal
               ORDER BY e.id DESC LIMIT 6""").fetchall()
        max_event = conn.execute("SELECT COALESCE(MAX(id), 0) FROM meal_events").fetchone()[0]

        active_requests = conn.execute(
            """SELECT lr.id, lr.status, lr.requested_at, lr.requested_meal_code,
                      lr.old_dish_code, lr.requested_dish_code, lr.alternative_meal_code,
                      lr.alternative_dish_code, lr.decision_note, lr.passenger_note,
                      p.first_name, p.last_name, p.seat, p.flight_id,
                      p.meal_code AS current_code, current_meal.name AS current_name,
                      requested.name AS requested_name, requested.color AS requested_color,
                      alternative.name AS alternative_name,
                      dc.dish_code AS current_dish_code
               FROM late_meal_requests lr
               JOIN passengers p ON p.id = lr.passenger_id
               LEFT JOIN meals current_meal ON current_meal.code = p.meal_code
               JOIN meals requested ON requested.code = lr.requested_meal_code
               LEFT JOIN meals alternative ON alternative.code = lr.alternative_meal_code
               LEFT JOIN passenger_dish_choices dc
                 ON dc.passenger_id = p.id AND dc.meal_code = p.meal_code
               WHERE lr.status IN ('pending', 'alternative_offered')
               ORDER BY CASE lr.status WHEN 'pending' THEN 0 ELSE 1 END, lr.requested_at ASC, lr.id ASC
               LIMIT 8""").fetchall()
        flight_from_conn = current_app.extensions.get("skybite_flight_from_conn")
        stock_remaining = current_app.extensions.get("skybite_late_stock_remaining")
        flight_cache = {}
        late_queue = []
        for lr in active_requests:
            flight_id = lr["flight_id"]
            if flight_id not in flight_cache and flight_from_conn:
                flight_cache[flight_id] = flight_from_conn(conn, flight_id)
            flight = flight_cache.get(flight_id)
            requested_spare = stock_remaining(conn, flight_id, lr["requested_meal_code"]) if stock_remaining else 0
            same_category = bool(lr["current_code"] and lr["current_code"] == lr["requested_meal_code"])
            current_dish = pf.dish_by_code(lr["current_dish_code"]) or pf.dish_by_code(lr["old_dish_code"])
            requested_dish = pf.dish_by_code(lr["requested_dish_code"])
            alternative_dish = pf.dish_by_code(lr["alternative_dish_code"])
            alternatives = []

            if lr["status"] == "pending" and flight:
                stock_rows = conn.execute(
                    """SELECT s.meal_code, m.name
                       FROM late_meal_stock s JOIN meals m ON m.code = s.meal_code
                       WHERE s.flight_id = ? ORDER BY m.sort""", (flight_id,)
                ).fetchall()
                stock_by_category = {item["meal_code"]: item["name"] for item in stock_rows}
                for category, category_dishes in pf.DISH_CATALOG.items():
                    if category not in stock_by_category and category != lr["current_code"]:
                        continue
                    spare = stock_remaining(conn, flight_id, category) if stock_remaining else 0
                    same_as_current = category == lr["current_code"]
                    if not same_as_current and spare < 1:
                        continue
                    for option in category_dishes:
                        if option["code"] in {lr["requested_dish_code"], lr["current_dish_code"], lr["old_dish_code"]}:
                            continue
                        alternatives.append({
                            "code": option["code"],
                            "name": option["name"],
                            "meal_code": category,
                            "meal_name": meal_names.get(category, category),
                            "spare": spare,
                            "same_category": same_as_current,
                        })

            late_queue.append({
                "id": lr["id"], "status": lr["status"],
                "name": f"{lr['first_name']} {lr['last_name']}", "seat": lr["seat"],
                "current_name": lr["current_name"] or "No meal selected", "current_code": lr["current_code"],
                "current_dish_name": current_dish["name"] if current_dish else None,
                "requested_name": lr["requested_name"], "requested_code": lr["requested_meal_code"],
                "requested_dish_name": requested_dish["name"] if requested_dish else None,
                "requested_color": lr["requested_color"], "requested_at": _stamp(lr["requested_at"]),
                "requested_spare": requested_spare, "same_category": same_category,
                "alternative_name": lr["alternative_name"],
                "alternative_dish_name": alternative_dish["name"] if alternative_dish else None,
                "decision_note": lr["decision_note"] or "",
                "passenger_note": lr["passenger_note"] or "", "alternatives": alternatives,
            })
    finally:
        conn.close()

    feed = []
    for event in events:
        new_display = _dish_display(event["new_dish_code"], event["new_name"])
        old_display = _dish_display(event["old_dish_code"], event["old_name"]) if event["old_name"] else None
        same_choice_note = bool(event["note"] and event["old_meal"] == event["new_meal"]
                                and event["old_dish_code"] == event["new_dish_code"])
        if same_choice_note:
            line = f"added a service note for {new_display}"
        else:
            line = f"chose {new_display}" if not old_display else f"changed from {old_display} to {new_display}"
        feed.append({
            "id": event["id"], "name": f"{event['first_name']} {event['last_name']}",
            "seat": event["seat"], "color": event["color"], "line": line,
            "meal": new_display, "source": SOURCES.get(event["source"], event["source"].capitalize()),
            "at": _stamp(event["at"]), "note": event["note"] or "",
        })
    return jsonify({
        "total": total, "not_chosen": not_chosen, "chosen": total - not_chosen,
        "whatsapp": whatsapp, "website": website,
        "rows": [{"code": row["code"], "name": row["name"], "color": row["color"], "n": row["n"]} for row in rows],
        "dishes_by_meal": dishes_by_meal,
        "feed": feed, "max_event": max_event, "late_requests": late_queue,
    })


def init_app(app):
    """Register the live crew data API."""
    app.register_blueprint(bp)
