"""The duplicate-game rule (rows.py classify) against the table shared with apps/web/scripts/duplicate-game.test.mjs, so the
reader's, the site's and the ratings' reading of "one game listed twice" cannot drift."""

import json
from pathlib import Path

import pytest
from rows import Game, classify

CASES = json.loads((Path(__file__).resolve().parents[2] / "apps/web/lib/duplicate-cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_shared_cases(case):
    games = [Game(d, h, a, hs, as_, "unknown", 1.0, "rated") for d, h, a, hs, as_ in case["rows"]]
    got = [i for i, g in enumerate(classify(games)) if g.kind == "duplicate"]
    assert got == case["duplicates"]
