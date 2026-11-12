"""Corrections (corrections.py) applied to game rows: one table shared with apps/web/scripts/corrections.test.mjs, so the
site's reading and the ratings' reading of data/corrections cannot drift."""

import csv
import json
from pathlib import Path

import pytest
from corrections import Corrections, apply_to_game, load_corrections
from rows import prepare, read_files

CASES = json.loads((Path(__file__).resolve().parents[2] / "apps/web/lib/correction-cases.json").read_text())


def write_corrections(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    stamp = {"source_url": "https://example.com/box", "reason": "box score", "corrected_on": "2030-11-01"}
    for name, rows, cols in (
        ("programs.csv", CASES["merges"], ["name", "same_as"]),
        ("games.csv", CASES["games"], ["game_date", "home", "away", "action", "home_score", "away_score"]),
    ):
        with open(directory / name, "w", newline="") as f:
            w = csv.DictWriter(f, [*cols, "source_url", "reason", "corrected_on"])
            w.writeheader()
            for r in rows:
                w.writerow({**r, **stamp})


@pytest.mark.parametrize("case", CASES["cases"], ids=[c["name"] for c in CASES["cases"]])
def test_the_shared_cases(tmp_path, case):
    write_corrections(tmp_path)
    date, home, away, hs, as_, reason = case["row"]
    got = apply_to_game(load_corrections(tmp_path), date, home, away, int(hs), int(as_), reason)
    if case["expect"] is None:
        assert got is None
    else:
        h, a, ehs, eas, er, _corrected = case["expect"]
        assert got == (h, a, int(ehs), int(eas), er)


def test_a_stray_double_quote_cannot_swallow_the_rows_below_it(tmp_path):
    # The same lines the site refuses (apps/web/scripts/corrections.test.mjs). Written raw: DictWriter would quote them.
    q = CASES["quoteFile"]
    (tmp_path / "games.csv").write_text("\n".join([q["header"], *q["lines"]]) + "\n")
    games = load_corrections(tmp_path).games
    assert sorted(fix.home for fix in games.values()) == sorted(q["pythonHomes"]), "the quote swallowed the next row"


def test_no_corrections_folder_is_no_corrections(tmp_path):
    c = load_corrections(tmp_path / "absent")
    assert c == Corrections()
    assert apply_to_game(c, "2030-09-05", "Alpha", "Beta", 40, 20, "regulation") == (
        "Alpha",
        "Beta",
        40,
        20,
        "regulation",
    )


def test_a_merge_into_a_merged_name_is_refused(tmp_path):
    (tmp_path / "programs.csv").write_text(
        "name,same_as,source_url,reason,corrected_on\n"
        "A,B,https://example.com,r,2030-01-01\nB,C,https://example.com,r,2030-01-01\n"
    )
    with pytest.raises(ValueError, match="itself merged"):
        load_corrections(tmp_path)


def robot_file(tmp_path, rows):
    path = tmp_path / "games.csv"
    lines = ["division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period"]
    lines += [f"I,season,{d},{h},{a},false,{hs},{as_},unknown,\n".rstrip("\n") for d, h, a, hs, as_ in rows]
    path.write_text("\n".join(lines) + "\n")
    return str(path)


def test_the_ratings_read_a_fixed_score_a_forfeit_a_void_and_a_merged_name(tmp_path):
    folder = tmp_path / "corrections"
    write_corrections(folder)
    path = robot_file(
        tmp_path,
        [
            ("2030-09-05", "Alpha", "Beta", 40, 20),  # fixed to 41-20
            ("2030-09-12", "Beta", "Gamma", 12, 14),  # a forfeit won by Gamma
            ("2030-09-19", "Gamma", "Alpha", 7, 6),  # listed in error
            ("2030-10-03", "Faith Acad", "Delta", 28, 12),  # one program, Faith Academy, and a fixed score
            ("2030-10-17", "Faith Academy", "Alpha", 14, 6),  # a game the merge does not touch
        ],
    )
    c = load_corrections(folder)
    games = list(read_files([path], corrections=c))
    assert [(g.date, g.home, g.away, g.home_score, g.away_score) for g in games] == [
        ("2030-09-05", "Alpha", "Beta", 41, 20),
        ("2030-09-12", "Beta", "Gamma", 0, 1),
        ("2030-10-03", "Faith Academy", "Delta", 30, 12),
        ("2030-10-17", "Faith Academy", "Alpha", 14, 6),
    ]
    assert games[1].end_reason == "forfeit"
    # And through the fit: the forfeit is in the records, not the fit; the void and the retired spelling are gone.
    s = prepare([path], corrections=c)
    assert s.report["forfeits"] == 1
    assert len(s.g.margin) == 3
    assert "Faith Acad" not in s.teams and "Faith Academy" in s.teams
    assert s.records["Gamma"] == [1, 0, 0]
