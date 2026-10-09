"""Crea su Garmin Connect un allenamento di nuoto a partire dalla struttura analizzata
(blocchi con ripetizioni, distanza, stile, attrezzi) e, se richiesto, lo mette in
calendario cosi' compare sull'orologio.

Uso (da shell o da PHP, con le stesse variabili d'ambiente di sync.py):
  python3 send_workout.py <file.json>            # crea (e pianifica) l'allenamento
  python3 send_workout.py --delete <workout_id>   # lo elimina

Il file JSON contiene: {"name": "...", "date": "YYYY-MM-DD" | null, "pool_length_m": 25,
"blocks": [...]}. Stampa una riga JSON con l'esito. Usa la sessione Garmin gia' salvata
da sync.py (login non ufficiale, come il resto del sito).
"""

from __future__ import annotations

import json
import sys

METER_UNIT = {"unitId": 1, "unitKey": "meter", "factor": 100.0}
SWIM = {"sportTypeId": 4, "sportTypeKey": "swimming", "displayOrder": 4}

STEP_TYPES = {
    "warmup": (1, "warmup"), "cooldown": (2, "cooldown"), "interval": (3, "interval"),
    "recovery": (4, "recovery"), "rest": (5, "rest"), "repeat": (6, "repeat"),
}
STROKES = {
    "any": (1, "any_stroke"), "back": (2, "backstroke"), "breast": (3, "breaststroke"),
    "drill": (4, "drill"), "fly": (5, "butterfly"), "free": (6, "free"),
    "im": (7, "individual_medley"), "mixed": (8, "mixed"),
}
EQUIPMENT = {
    "fins": (1, "fins"), "kickboard": (2, "kickboard"), "paddles": (3, "paddles"),
    "pull_buoy": (4, "pull_buoy"), "snorkel": (5, "snorkel"),
}
# Garmin accetta un solo attrezzo per passo: quando ce ne sono piu' si sceglie il primo di
# questa lista e gli altri restano nella descrizione.
EQUIPMENT_PRIORITY = ["paddles", "fins", "pull_buoy", "kickboard", "snorkel"]
EQUIPMENT_LABELS_IT = {
    "fins": "pinne", "kickboard": "tavola", "paddles": "palette", "pull_buoy": "pull", "snorkel": "snorkel",
}
SECONDS_PER_100M = 120  # stima della durata mostrata sull'orologio (2:00/100 m)


def _typed(prefix: str, table: dict, key: str, default: str) -> dict:
    ident, name = table.get(key) or table[default]
    return {f"{prefix}TypeId": ident, f"{prefix}TypeKey": name, "displayOrder": ident}


def _executable(order: int, kind: str, distance_m: float | None, seconds: float | None,
                stroke: str, equipment: list, description: str) -> dict:
    primary = next((e for e in EQUIPMENT_PRIORITY if e in equipment), None)
    if distance_m is not None:
        end = {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": True}
        value, unit = float(distance_m), METER_UNIT
    elif seconds is not None:
        end = {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True}
        value, unit = float(seconds), None
    else:
        end = {"conditionTypeId": 1, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": True}
        value, unit = 0.0, None
    return {
        "type": "ExecutableStepDTO", "stepOrder": order,
        "stepType": _typed("step", STEP_TYPES, kind, "interval"),
        "childStepId": None, "description": description[:500] or None,
        "endCondition": end, "endConditionValue": value, "preferredEndConditionUnit": unit,
        "endConditionCompare": None, "targetType": None, "targetValueOne": None, "targetValueTwo": None,
        "targetValueUnit": None, "zoneNumber": None, "secondaryTargetType": None,
        "secondaryTargetValueOne": None, "secondaryTargetValueTwo": None, "secondaryTargetValueUnit": None,
        "secondaryZoneNumber": None, "endConditionZone": None,
        "strokeType": _typed("stroke", STROKES, stroke, "any") if kind != "rest" else {"strokeTypeId": 0, "strokeTypeKey": None, "displayOrder": 0},
        "equipmentType": ({"equipmentTypeId": EQUIPMENT[primary][0], "equipmentTypeKey": EQUIPMENT[primary][1], "displayOrder": EQUIPMENT[primary][0]}
                          if primary and kind != "rest" else {"equipmentTypeId": 0, "equipmentTypeKey": None, "displayOrder": 0}),
        "category": None, "exerciseName": None, "workoutProvider": None, "providerExerciseSourceId": None,
        "weightValue": None, "weightUnit": None,
    }


def _description(block: dict, equipment: list, extra: str = "") -> str:
    parts = []
    if block.get("label"):
        parts.append(block["label"])
    if equipment:
        parts.append(" + ".join(EQUIPMENT_LABELS_IT[e] for e in equipment if e in EQUIPMENT_LABELS_IT))
    if block.get("note"):
        parts.append(block["note"])
    if extra:
        parts.append(extra)
    return " · ".join(p for p in parts if p)


def build_steps(blocks: list) -> tuple[list, float]:
    """Passi Garmin (con gruppi di ripetizioni) e distanza totale in metri."""
    steps: list = []
    order = 0
    total = 0.0

    def nxt() -> int:
        nonlocal order
        order += 1
        return order

    for b in blocks:
        reps, dist = int(b["reps"]), float(b["distance_m"])
        total += reps * dist
        kind = b.get("kind") or "interval"
        stroke = b.get("stroke") or "any"
        rest_s = b.get("rest_s")
        alt = b.get("alternate")
        base_eq = list(b.get("equipment") or [])

        def one(eq: list, extra: str = "") -> dict:
            return _executable(nxt(), kind, dist, None, stroke, eq, _description(b, eq, extra))

        def rest_step() -> dict:
            return _executable(nxt(), "rest", None, rest_s, "any", [], "")

        if alt and reps % 2 == 0 and reps >= 2:
            group_order = nxt()
            children = []
            for label, key in (("dispari", "odd"), ("pari", "even")):
                variant = alt.get(key) or {}
                eq = list(variant.get("equipment") or [])
                extra = label + (": " + variant["note"] if variant.get("note") else "")
                children.append(one(eq, extra))
                if rest_s:
                    children.append(rest_step())
            steps.append(_repeat(group_order, reps // 2, children))
        elif reps > 1:
            group_order = nxt()
            children = [one(base_eq)]
            if rest_s:
                children.append(rest_step())
            steps.append(_repeat(group_order, reps, children))
        else:
            steps.append(one(base_eq))
            if rest_s:
                steps.append(rest_step())
    return steps, total


def _repeat(order: int, iterations: int, children: list, skip_last_rest: bool | None = None) -> dict:
    return {
        "type": "RepeatGroupDTO", "stepOrder": order, "stepType": _typed("step", STEP_TYPES, "repeat", "repeat"),
        "childStepId": 1, "numberOfIterations": iterations, "workoutSteps": children,
        "endConditionValue": float(iterations), "preferredEndConditionUnit": None, "endConditionCompare": None,
        "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": False},
        "skipLastRestStep": skip_last_rest, "smartRepeat": False,
    }


RUN = {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1}
KM_UNIT = {"unitId": 2, "unitKey": "kilometer", "factor": 100000.0}
RUN_TARGETS = {"none": (1, "no.target"), "hr": (4, "heart.rate.zone"), "pace": (6, "pace.zone")}
RUN_KINDS = {"warmup": (1, "warmup"), "cooldown": (2, "cooldown"), "interval": (3, "interval"), "recovery": (4, "recovery")}
DEFAULT_RUN_SPEED = 2.8  # m/s (~5:57/km) per stimare la durata dei passi a distanza senza ritmo


def _run_executable(order: int, st: dict) -> dict:
    kind = st.get("kind") or "interval"
    ident, key = RUN_KINDS.get(kind, RUN_KINDS["interval"])
    if st.get("distance_m"):
        end = {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": True}
        value, unit = float(st["distance_m"]), KM_UNIT
    elif st.get("time_s"):
        end = {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True}
        value, unit = float(st["time_s"]), None
    else:
        end = {"conditionTypeId": 1, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": True}
        value, unit = 0.0, None

    target, one, two, zone = RUN_TARGETS["none"], None, None, None
    pace = st.get("pace")
    if pace:  # [piu' veloce, piu' lento] in secondi al km -> velocita' in m/s
        target, one, two = RUN_TARGETS["pace"], 1000.0 / float(pace[0]), 1000.0 / float(pace[1])
    elif st.get("hr_zone"):
        target, zone = RUN_TARGETS["hr"], int(st["hr_zone"])
    return {
        "type": "ExecutableStepDTO", "stepOrder": order, "stepType": {"stepTypeId": ident, "stepTypeKey": key, "displayOrder": ident},
        "childStepId": None, "description": (st.get("note") or "")[:500] or None,
        "endCondition": end, "endConditionValue": value, "preferredEndConditionUnit": unit, "endConditionCompare": None,
        "targetType": {"workoutTargetTypeId": target[0], "workoutTargetTypeKey": target[1], "displayOrder": target[0]},
        "targetValueOne": one, "targetValueTwo": two, "targetValueUnit": None, "zoneNumber": zone,
        "secondaryTargetType": None, "secondaryTargetValueOne": None, "secondaryTargetValueTwo": None,
        "secondaryTargetValueUnit": None, "secondaryZoneNumber": None, "endConditionZone": None,
        "strokeType": {"strokeTypeId": 0, "strokeTypeKey": None, "displayOrder": 0},
        "equipmentType": {"equipmentTypeId": 0, "equipmentTypeKey": None, "displayOrder": 0},
        "category": None, "exerciseName": None, "workoutProvider": None, "providerExerciseSourceId": None,
        "weightValue": None, "weightUnit": None,
    }


def build_run_steps(steps: list) -> tuple[list, float, float]:
    """Passi Garmin della corsa (con gruppi di ripetizioni) e stima di distanza e durata."""
    order = 0
    dist_total = 0.0
    secs_total = 0.0

    def nxt() -> int:
        nonlocal order
        order += 1
        return order

    def estimate(st: dict, times: int) -> None:
        nonlocal dist_total, secs_total
        pace = st.get("pace")
        speed = (1000.0 / ((float(pace[0]) + float(pace[1])) / 2)) if pace else DEFAULT_RUN_SPEED
        if st.get("distance_m"):
            dist_total += float(st["distance_m"]) * times
            secs_total += float(st["distance_m"]) / speed * times
        elif st.get("time_s"):
            dist_total += float(st["time_s"]) * speed * times
            secs_total += float(st["time_s"]) * times

    def build(items: list, times: int) -> list:
        out = []
        for st in items:
            if st.get("kind") == "repeat":
                group_order = nxt()
                reps = int(st["reps"])
                children = build(st["steps"], times * reps)
                out.append(_repeat(group_order, reps, children, bool(st.get("skip_last_rest", True))))
            else:
                estimate(st, times)
                out.append(_run_executable(nxt(), st))
        return out

    return build(steps, 1), dist_total, secs_total


def build_run_workout(spec: dict) -> dict:
    steps, dist, secs = build_run_steps(spec["steps"])
    return {
        "workoutName": spec["name"][:80], "description": (spec.get("description") or None),
        "sportType": RUN, "estimatedDistanceInMeters": round(dist, 1), "estimatedDurationInSecs": int(secs),
        "workoutSegments": [{"segmentOrder": 1, "sportType": RUN, "workoutSteps": steps}],
    }


def build_workout(spec: dict) -> dict:
    if spec.get("sport") == "running":
        return build_run_workout(spec)
    steps, total = build_steps(spec["blocks"])
    pool = float(spec.get("pool_length_m") or 25)
    return {
        "workoutName": spec["name"][:80], "description": (spec.get("description") or None),
        "sportType": SWIM, "estimatedDistanceInMeters": total,
        "estimatedDurationInSecs": int(total / 100 * SECONDS_PER_100M),
        "poolLength": pool, "poolLengthUnit": METER_UNIT,
        "workoutSegments": [{"segmentOrder": 1, "sportType": SWIM, "workoutSteps": steps}],
    }


def main(argv: list) -> int:
    import sync  # login con la sessione salvata; solo qui cosi' build_* si prova senza Garmin

    if len(argv) >= 3 and argv[1] == "--delete":
        client = sync.login()
        client.connectapi(f"/workout-service/workout/{int(argv[2])}", method="DELETE")
        print(json.dumps({"ok": True, "deleted": int(argv[2])}))
        return 0

    with open(argv[1], encoding="utf-8") as fh:
        spec = json.load(fh)
    payload = build_workout(spec)
    client = sync.login()
    created = client.connectapi("/workout-service/workout", method="POST", json=payload)
    workout_id = created.get("workoutId")
    result = {"ok": bool(workout_id), "garmin_id": workout_id, "scheduled": False}
    if workout_id and spec.get("date"):
        client.connectapi(f"/workout-service/schedule/{workout_id}", method="POST", json={"date": spec["date"]})
        result["scheduled"] = True
    print(json.dumps(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
