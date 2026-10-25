"""Database setup and fake demo data for SkyBite.

Run `python db.py --reset` to delete the database and rebuild it from scratch.
"""
import os
import random
import sqlite3
import sys
from datetime import datetime, timedelta

from werkzeug.security import generate_password_hash

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "skybite.db")

# The demo has its own clock so you can "fast-forward" without waiting.
# It starts about 56 hours before the demo flight departs.
DEMO_NOW = "2026-10-16T10:00:00"
DEMO_DEPARTURE = "2026-10-18T18:30:00"
KITCHEN_CUTOFF_HOURS = 4

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meals (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    color TEXT NOT NULL,
    festival_only INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS festivals (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    meal_codes TEXT NOT NULL,
    note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flights (
    id INTEGER PRIMARY KEY,
    number TEXT NOT NULL,
    origin TEXT NOT NULL,
    origin_city TEXT NOT NULL,
    dest TEXT NOT NULL,
    dest_city TEXT NOT NULL,
    departs_at TEXT NOT NULL,
    rows INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
    pnr TEXT PRIMARY KEY,
    flight_id INTEGER NOT NULL REFERENCES flights(id)
);
CREATE TABLE IF NOT EXISTS passengers (
    id INTEGER PRIMARY KEY,
    pnr TEXT NOT NULL REFERENCES bookings(pnr),
    flight_id INTEGER NOT NULL REFERENCES flights(id),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    seat TEXT NOT NULL,
    meal_code TEXT REFERENCES meals(code),
    meal_source TEXT,            -- booking | whatsapp | website | late_request
    meal_updated_at TEXT,
    UNIQUE (flight_id, seat)
);
CREATE TABLE IF NOT EXISTS meal_events (
    id INTEGER PRIMARY KEY,
    passenger_id INTEGER NOT NULL REFERENCES passengers(id),
    old_meal TEXT,
    new_meal TEXT NOT NULL,
    source TEXT NOT NULL,
    at TEXT NOT NULL,
    old_dish_code TEXT,
    new_dish_code TEXT,
    note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS historical_meal_counts (
    flight_number TEXT NOT NULL,
    flight_date TEXT NOT NULL,
    route TEXT NOT NULL,
    festival_name TEXT,
    meal_code TEXT NOT NULL REFERENCES meals(code),
    meal_count INTEGER NOT NULL CHECK (meal_count >= 0),
    PRIMARY KEY (flight_number, meal_code)
);
CREATE TABLE IF NOT EXISTS late_meal_requests (
    id INTEGER PRIMARY KEY,
    passenger_id INTEGER NOT NULL REFERENCES passengers(id),
    old_meal_code TEXT REFERENCES meals(code),
    requested_meal_code TEXT NOT NULL REFERENCES meals(code),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'declined', 'alternative_offered', 'alternative_accepted', 'alternative_declined')),
    alternative_meal_code TEXT REFERENCES meals(code),
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT,
    decision_note TEXT,
    old_dish_code TEXT,
    requested_dish_code TEXT,
    alternative_dish_code TEXT,
    passenger_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_late_requests_status_time
    ON late_meal_requests(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_late_requests_passenger
    ON late_meal_requests(passenger_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_late_requests_one_active_per_passenger
    ON late_meal_requests(passenger_id) WHERE status IN ('pending', 'alternative_offered');
CREATE TABLE IF NOT EXISTS late_meal_stock (
    flight_id INTEGER NOT NULL REFERENCES flights(id),
    meal_code TEXT NOT NULL REFERENCES meals(code),
    planned_qty INTEGER NOT NULL CHECK (planned_qty >= 0),
    snapshot_at TEXT NOT NULL,
    PRIMARY KEY (flight_id, meal_code)
);
CREATE TABLE IF NOT EXISTS flight_operations (
    flight_id INTEGER PRIMARY KEY REFERENCES flights(id) ON DELETE CASCADE,
    on_flight_mode INTEGER NOT NULL DEFAULT 0,
    mode_started_at TEXT,
    mode_ended_at TEXT,
    updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS passenger_meal_service (
    passenger_id INTEGER PRIMARY KEY REFERENCES passengers(id) ON DELETE CASCADE,
    flight_id INTEGER NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
    meal_code TEXT NOT NULL REFERENCES meals(code),
    dish_code TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('delivered', 'not_delivered', 'cancelled')),
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_meal_service_flight_status
    ON passenger_meal_service(flight_id, status, meal_code);
CREATE TABLE IF NOT EXISTS meal_exchange_offers (
    id INTEGER PRIMARY KEY,
    flight_id INTEGER NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
    source_passenger_id INTEGER NOT NULL REFERENCES passengers(id),
    meal_code TEXT NOT NULL REFERENCES meals(code),
    dish_code TEXT NOT NULL,
    original_price INTEGER NOT NULL CHECK (original_price >= 0),
    discount_percent INTEGER NOT NULL DEFAULT 20 CHECK (discount_percent = 20),
    discounted_price INTEGER NOT NULL CHECK (discounted_price >= 0),
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold', 'expired', 'withdrawn')),
    created_at TEXT NOT NULL,
    sold_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_exchange_offers_flight_status
    ON meal_exchange_offers(flight_id, status, created_at);
CREATE TABLE IF NOT EXISTS meal_exchange_purchases (
    id INTEGER PRIMARY KEY,
    offer_id INTEGER NOT NULL UNIQUE REFERENCES meal_exchange_offers(id),
    flight_id INTEGER NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
    buyer_passenger_id INTEGER NOT NULL REFERENCES passengers(id),
    seller_passenger_id INTEGER NOT NULL REFERENCES passengers(id),
    meal_code TEXT NOT NULL REFERENCES meals(code),
    dish_code TEXT NOT NULL,
    original_price INTEGER NOT NULL,
    discount_percent INTEGER NOT NULL DEFAULT 20,
    amount_paid INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'purchased' CHECK (status IN ('purchased', 'refunded', 'cancelled')),
    service_status TEXT NOT NULL DEFAULT 'pending' CHECK (service_status IN ('pending', 'delivered', 'not_delivered')),
    purchased_at TEXT NOT NULL,
    updated_at TEXT,
    updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_exchange_purchases_buyer
    ON meal_exchange_purchases(buyer_passenger_id, status, purchased_at);
CREATE TABLE IF NOT EXISTS crew (
    staff_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    pnr TEXT NOT NULL,
    direction TEXT NOT NULL,     -- out = airline to passenger, in = passenger to airline
    body TEXT NOT NULL,
    actions TEXT,                -- buttons or a list, stored as JSON
    kind TEXT NOT NULL DEFAULT 'chat',   -- chat | reminder48 | reminder6 | reminder4 | sync
    sent_at TEXT NOT NULL
);
"""

# code, name, category, description, colour, festival_only, sort
MEALS = [
    ("navratri", "Navratri vrat thali", "Festival and fasting",
     "Sabudana khichdi, kuttu roti and sendha namak. No grains, onion or garlic.", "#E2682F", 1, 1),
    ("ekadashi", "Ekadashi fasting meal", "Festival and fasting",
     "Fruit, makhana and a light potato dish cooked with rock salt. No grains or pulses.", "#C9A227", 1, 2),
    ("ramzan", "Ramzan iftar and suhoor box", "Festival and fasting",
     "Dates, fruit chaat and a hot halal meal, served at sunset or before dawn.", "#2D6A6F", 1, 3),
    ("jain", "Strict Jain", "Religious and cultural",
     "No onion, garlic or root vegetables such as potato, carrot, beetroot and radish.", "#1F8FBF", 0, 4),
    ("sattvik", "Sattvik", "Religious and cultural",
     "Freshly cooked and light. No onion, garlic, meat, eggs or alcohol.", "#D9A21B", 0, 5),
    ("halal", "Halal non-vegetarian", "Religious and cultural",
     "Halal-certified chicken or mutton curry with rice or roti.", "#7A5BD0", 0, 6),
    ("veg", "Vegetarian", "Everyday",
     "Paneer or dal with rice or roti and a seasonal vegetable.", "#4FA66B", 0, 7),
    ("nonveg", "Non-vegetarian", "Everyday",
     "Chicken curry with rice or roti.", "#B8503B", 0, 8),
    ("diabetic", "Diabetic friendly", "Health",
     "Low sugar and high fibre, with whole grains.", "#8E4B8F", 0, 9),
    ("lowsodium", "Low sodium", "Health",
     "Cooked with very little salt. No pickle or papad.", "#6B7A90", 0, 10),
    ("nutfree", "Nut-free", "Allergy",
     "Made without peanuts or tree nuts and sealed separately.", "#D63049", 0, 11),
    ("gluten", "Gluten-free", "Allergy",
     "No wheat, barley or semolina. Rice-based.", "#A07C4B", 0, 12),
    ("child", "Child meal", "Everyday",
     "Mild flavours with fruit and a milk drink.", "#E57BA2", 0, 13),
]

# name, start, end, meal codes, note
# Dates were checked against Drik Panchang for Oct-Dec 2026. Check Ramzan again before use.
FESTIVALS = [
    ("Navratri", "2026-10-11", "2026-10-20", "navratri,sattvik,jain,veg",
     "Your flight falls during Navratri."),
    ("Ekadashi", "2026-10-22", "2026-10-22", "ekadashi,sattvik,jain,veg",
     "Your flight falls on Ekadashi."),
    ("Ekadashi", "2026-11-05", "2026-11-05", "ekadashi,sattvik,jain,veg",
     "Your flight falls on Ekadashi."),
    ("Ekadashi", "2026-11-20", "2026-11-20", "ekadashi,sattvik,jain,veg",
     "Your flight falls on Ekadashi."),
    ("Ekadashi", "2026-12-04", "2026-12-04", "ekadashi,sattvik,jain,veg",
     "Your flight falls on Ekadashi."),
    ("Ekadashi", "2026-12-20", "2026-12-20", "ekadashi,sattvik,jain,veg",
     "Your flight falls on Ekadashi."),
    ("Ramzan", "2026-02-18", "2026-03-19", "ramzan,halal,veg,diabetic",
     "Your flight falls during Ramzan."),
]

FIRST = ["Aarav", "Vivaan", "Aditya", "Arjun", "Rohan", "Karan", "Ishaan", "Rahul", "Amit", "Sanjay",
         "Priya", "Ananya", "Diya", "Kavya", "Meera", "Neha", "Pooja", "Riya", "Sneha", "Tanvi",
         "Farhan", "Zoya", "Imran", "Ayesha", "Harpreet", "Simran", "Gurpreet", "Manpreet",
         "Lakshmi", "Suresh", "Anand", "Divya", "Rajesh", "Sunita", "Vikram", "Nisha"]
LAST = ["Sharma", "Verma", "Gupta", "Singh", "Patel", "Shah", "Iyer", "Nair", "Reddy", "Khan",
        "Kapoor", "Malhotra", "Joshi", "Desai", "Bansal", "Chopra", "Sethi", "Bhatia", "Menon", "Rao",
        "Jain", "Agarwal", "Mishra", "Banerjee", "Ahmed", "Gill", "Kaur", "Thakur"]

# Share of passengers by meal for the demo flight (None = has not chosen yet).
MEAL_WEIGHTS = [
    ("veg", 32), ("nonveg", 17), ("halal", 4), ("jain", 6), ("sattvik", 4),
    ("diabetic", 4), ("lowsodium", 2), ("nutfree", 2), ("gluten", 2), ("child", 3),
    (None, 24),
]

# Illustrative historic choices for the hackathon demo. The original project had no
# stored prior-flight records, so these rows are explicitly labelled sample history in UI.
# Each map is the number of passengers who selected that meal on a comparable DEL-BOM flight.
DEMO_HISTORICAL_FLIGHTS = [
    {"number": "SB 208", "date": "2025-10-05", "route": "DEL-BOM", "festival": "Navratri",
     "meals": {"navratri": 20, "sattvik": 15, "jain": 9, "veg": 34, "nonveg": 24,
               "halal": 4, "diabetic": 5, "lowsodium": 3, "nutfree": 2, "gluten": 3, "child": 5}},
    {"number": "SB 216", "date": "2024-10-12", "route": "DEL-BOM", "festival": "Navratri",
     "meals": {"navratri": 18, "sattvik": 14, "jain": 8, "veg": 32, "nonveg": 22,
               "halal": 4, "diabetic": 4, "lowsodium": 2, "nutfree": 2, "gluten": 3, "child": 4}},
    {"number": "SB 204", "date": "2023-10-21", "route": "DEL-BOM", "festival": "Navratri",
     "meals": {"navratri": 23, "sattvik": 18, "jain": 10, "veg": 38, "nonveg": 27,
               "halal": 5, "diabetic": 5, "lowsodium": 3, "nutfree": 3, "gluten": 3, "child": 6}},
    {"number": "SB 222", "date": "2022-10-04", "route": "DEL-BOM", "festival": "Navratri",
     "meals": {"navratri": 21, "sattvik": 16, "jain": 9, "veg": 35, "nonveg": 24,
               "halal": 4, "diabetic": 5, "lowsodium": 2, "nutfree": 2, "gluten": 3, "child": 5}},
    {"number": "SB 202", "date": "2025-08-14", "route": "DEL-BOM", "festival": None,
     "meals": {"veg": 37, "nonveg": 34, "halal": 8, "jain": 6, "sattvik": 6, "diabetic": 5,
               "lowsodium": 3, "nutfree": 2, "gluten": 3, "child": 8}},
    {"number": "SB 206", "date": "2025-07-28", "route": "DEL-BOM", "festival": None,
     "meals": {"veg": 35, "nonveg": 37, "halal": 9, "jain": 7, "sattvik": 5, "diabetic": 4,
               "lowsodium": 2, "nutfree": 3, "gluten": 4, "child": 7}},
    {"number": "SB 218", "date": "2025-06-11", "route": "DEL-BOM", "festival": None,
     "meals": {"veg": 38, "nonveg": 32, "halal": 7, "jain": 5, "sattvik": 6, "diabetic": 5,
               "lowsodium": 3, "nutfree": 3, "gluten": 3, "child": 9}},
    {"number": "SB 210", "date": "2025-05-19", "route": "DEL-BOM", "festival": None,
     "meals": {"veg": 34, "nonveg": 35, "halal": 8, "jain": 6, "sattvik": 7, "diabetic": 5,
               "lowsodium": 2, "nutfree": 2, "gluten": 3, "child": 7}},
    {"number": "SB 226", "date": "2025-03-07", "route": "DEL-BOM", "festival": None,
     "meals": {"veg": 36, "nonveg": 38, "halal": 7, "jain": 6, "sattvik": 5, "diabetic": 4,
               "lowsodium": 2, "nutfree": 3, "gluten": 3, "child": 6}},
    {"number": "SB 230", "date": "2024-12-18", "route": "DEL-BOM", "festival": None,
     "meals": {"veg": 37, "nonveg": 36, "halal": 8, "jain": 5, "sattvik": 5, "diabetic": 5,
               "lowsodium": 2, "nutfree": 2, "gluten": 3, "child": 8}},
]


DEMO_PNR = "VM4K9Z"


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_schema_compatibility(conn):
    """Add optional columns to databases created by older SkyBite demo versions."""
    additions = {
        "meal_events": {"note": "TEXT NOT NULL DEFAULT ''"},
        "late_meal_requests": {"passenger_note": "TEXT NOT NULL DEFAULT ''"},
    }
    for table, columns in additions.items():
        present = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        for column, declaration in columns.items():
            if column not in present:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
    conn.commit()


def init_db():
    """Create the database, migrate older demo schemas, and fill missing demo data."""
    fresh = not os.path.exists(DB_PATH)
    conn = connect()
    conn.executescript(SCHEMA)
    ensure_schema_compatibility(conn)
    if fresh or conn.execute("SELECT COUNT(*) FROM meals").fetchone()[0] == 0:
        seed(conn)
    seed_historical_demand(conn)
    conn.execute("INSERT OR IGNORE INTO flight_operations (flight_id, on_flight_mode) SELECT id, 0 FROM flights")
    conn.commit()
    conn.close()


def seed_historical_demand(conn):
    """Seed transparent sample history so the forecasting workflow runs in the demo."""
    if conn.execute("SELECT COUNT(*) FROM historical_meal_counts").fetchone()[0]:
        return
    for flight in DEMO_HISTORICAL_FLIGHTS:
        for code, count in flight["meals"].items():
            conn.execute(
                "INSERT INTO historical_meal_counts "
                "(flight_number, flight_date, route, festival_name, meal_code, meal_count) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (flight["number"], flight["date"], flight["route"], flight["festival"], code, count),
            )
    conn.commit()


def seed(conn):
    rng = random.Random(42)  # same fake data every time

    conn.execute("INSERT OR REPLACE INTO settings VALUES ('demo_now', ?)", (DEMO_NOW,))
    conn.executemany("INSERT INTO meals VALUES (?,?,?,?,?,?,?)", MEALS)
    conn.executemany(
        "INSERT INTO festivals (name, start_date, end_date, meal_codes, note) VALUES (?,?,?,?,?)",
        FESTIVALS)
    conn.execute(
        "INSERT INTO flights VALUES (1, 'SB 214', 'DEL', 'Delhi', 'BOM', 'Mumbai', ?, 25)",
        (DEMO_DEPARTURE,))

    conn.executemany("INSERT INTO crew VALUES (?,?,?,?)", [
        ("SB1001", "Anita Rao", "Ground and cabin", generate_password_hash("crew123")),
        ("SB1002", "Rahul Menon", "Kitchen liaison", generate_password_hash("crew123")),
    ])

    base_time = datetime.fromisoformat(DEMO_NOW)
    seats = [f"{r}{c}" for r in range(1, 26) for c in "ABCDEF"]
    pnrs = set()

    def new_pnr():
        while True:
            p = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
            if p not in pnrs and p != DEMO_PNR:
                pnrs.add(p)
                return p

    def add_booking(pnr, people):
        conn.execute("INSERT INTO bookings VALUES (?, 1)", (pnr,))
        for first, last, seat, meal in people:
            if meal:
                when = (base_time - timedelta(days=rng.randint(2, 20), hours=rng.randint(0, 20))).isoformat()
                source = "booking"
            else:
                when, source = None, None
            conn.execute(
                "INSERT INTO passengers (pnr, flight_id, first_name, last_name, seat, meal_code,"
                " meal_source, meal_updated_at) VALUES (?,?,?,?,?,?,?,?)",
                (pnr, 1, first, last, seat, meal, source, when))

    # The demo family. Varun has not chosen a meal, so he is the one who gets the WhatsApp message.
    pnrs.add(DEMO_PNR)
    add_booking(DEMO_PNR, [
        ("Varun", "Mehta", "13A", None),
        ("Neha", "Mehta", "13B", "sattvik"),
        ("Aarav", "Mehta", "13C", "child"),
    ])
    taken = {"13A", "13B", "13C"}

    free = [s for s in seats if s not in taken]
    empty = set(rng.sample(free, 12))          # 12 empty seats on the aircraft
    free = [s for s in free if s not in empty]

    meals, weights = zip(*MEAL_WEIGHTS)
    i = 0
    while i < len(free):
        size = rng.choices([1, 2, 3, 4], weights=[58, 28, 9, 5])[0]
        group = free[i:i + size]
        i += size
        last = rng.choice(LAST)
        used_first = set()
        people = []
        for seat in group:
            first = rng.choice(FIRST)
            while first in used_first:
                first = rng.choice(FIRST)
            used_first.add(first)
            people.append((first, last, seat, rng.choices(meals, weights=weights)[0]))
        add_booking(new_pnr(), people)

    conn.commit()


TABLES = ["meal_exchange_purchases", "meal_exchange_offers", "passenger_meal_service",
          "flight_operations", "late_meal_stock", "late_meal_requests", "messages", "meal_events",
          "historical_meal_counts", "passengers", "bookings", "flights", "festivals",
          "meals", "crew", "settings"]


def reset_demo(conn):
    """Put the demo back to the start, including service, exchange and dish-level choices."""
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    existing_tables = {row["name"] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).fetchall()}
    # Passenger feature tables are created by passenger_features.init_app rather than
    # the base schema. Clear them before re-seeding IDs so old dish choices/preferences
    # cannot leak into the freshly reset demo passengers.
    for table in ("pw_meal_preferences", "pw_meal_selections", "passenger_dish_choices"):
        if table in existing_tables:
            conn.execute(f"DELETE FROM {table}")
    for table in TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.executescript(SCHEMA)
    ensure_schema_compatibility(conn)
    seed(conn)
    seed_historical_demand(conn)
    conn.execute("INSERT OR IGNORE INTO flight_operations (flight_id, on_flight_mode) SELECT id, 0 FROM flights")
    # When reset is invoked from the running web app, restore deterministic default
    # dish choices for the freshly seeded passengers. The CLI database reset remains
    # independent of Flask/passenger_features and can seed dishes on next app start.
    passenger_feature_module = sys.modules.get("passenger_features")
    table_check = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='passenger_dish_choices'"
    ).fetchone()
    if passenger_feature_module and table_check:
        passenger_feature_module._seed_demo_dishes(conn)
    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")


if __name__ == "__main__":
    if "--reset" in sys.argv and os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print("Old database deleted.")
    init_db()
    c = connect()
    n = c.execute("SELECT COUNT(*) FROM passengers").fetchone()[0]
    print(f"Database ready with {n} passengers.")
