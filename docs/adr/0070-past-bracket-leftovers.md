# ADR 0070: TCAF's two six-man divisions, a school's own team page, and a void reviewed with its score

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It settles three things ADR 0069 left open.
It keeps ADR 0031's store rules and ADR 0069's whole-bracket rule.

## Context
- **TCAF.** TCAF's 2018 to 2021 seasons had two six-man divisions. Each game's own bracket says which ("6 Man I",
  "6-Man II"), but the reader stored every TCAF game under one "Six-Man" bracket. A season then showed two State
  Championship games in one bracket, and ADR 0069 had to leave TCAF's last week unchecked and its brackets partial.
  2022 to 2024 name only "6-Man II", one six-man division, and 2025 names the bracket just "TCAF".
- **Wilson, 2018.** Some West Texas schedules (2018 Anton; 2019 to 2021 Cotton Center, Jayton, Klondike, Loop, Welch
  Dawson and others) link their opponent "Wilson" to a Dallas school's page of the same name. The reader matches an
  opponent by name, and the last link it saw became Wilson's team page, so a 2018 reread wrote the Dallas page into
  `teams.csv`. All ten of Wilson's 2018 games are against South Plains six-man schools (Lazbuddie, Klondike, Jayton,
  Cotton Center, Kress, Welch Dawson, Loop, Southland, Anton). The Dallas page says "Division 5A-1" (11-man) and Wilson's
  own page says "1A 6 Man 2". It is the Lynn County school, as the stored file and every other season have it.
- **A void with a score.** The 2023-11-03 TCAF quarterfinal row naming Methodist Children's and Sherman Grayson is voided
  by `data/corrections` (Methodist cannot win 50-0 twice in one night). `check-data` warned that the voided row "now
  reads" a score, a warning meant for a placeholder that later gets a score. This game carried that score in `games.csv`
  when it was voided.

## Decision
1. **TCAF is split into its divisions where the whole season shows them.** A TCAF game's bracket name keeps its division
   (`bracketOf` returns `part`). On a past season's full reread, `splitTcafDivisions` gives each stored TCAF "Six-Man"
   row the division its own bracket names. It does so only when the season is whole: both divisions named, every stored
   TCAF row's game named by this read, and each division alone a complete, consistent bracket (one State Championship
   game, no week holding more games than its round can). Otherwise every row stays "Six-Man" and the run summary says
   why. Only the division changes; teams, dates, scores, sources and rounds stand, and rounds are then named again per
   division (ADR 0069). A season that names one division (2022 to 2025) is left as one bracket.
2. **A school's team page is the one that says six-man.** When opponents' schedules link one of our schools to more than
   one page, a past season keeps the page whose own page says six-man that season, then any page that does not say
   11-man, then the last seen, as before (`pickTeamPage`). The season under way reads no football kind, so there the
   last seen still stands.
3. **A void reviewed with the score in view is not a warning.** `voidedButScored` stays quiet when the season's
   `games.csv` lists the same voided game with the same score: the correction was made against that score. A voided
   placeholder that later reads a score, or a voided game whose score changes, is still named for review. The void
   stays.

## Measurement
- TCAF: 38 stored rows split into 8 brackets (2018: I 3, II 5; 2019 to 2021: I 3, II 7 each), each with one State
  Championship game. No other value changed, and the gap counts (ADR 0069's measure) are the same before and after:
  236 listed games, 19 proven open slots, 9 late first games with a game that week, 70 likely byes for 2018 to 2021.
  2018 TCAF II's one proven open slot is a semifinal no listed page shows.
- Wilson: the 2018 reread now writes the Lynn County page; `teams.csv` is unchanged from the stored file.
- `check-data`: 4 warnings → 3; the void stays.

## Consequences
- 2018 to 2021 TCAF pages show "TCAF Division I" and "TCAF Division II" brackets, each with its own State Championship.
- A new TCAF game found by a later read arrives as "Six-Man" and stays so until a full reread can place it.
- A later school that shares a name with an 11-man school keeps its own page without a hand-written alias.
