-- Every mention of a playoff final reads "State Championship" (Nov 14, 2026). The Playoffs board's description, seeded
-- by migration 0015, said "state finals"; the site's board list (apps/web/lib/forum-boards.ts) now says
-- "State Championships", and a test checks the two agree. Migration 0015 is left as it was.
update forum_board
   set description = 'Brackets, matchups and the road to the State Championships.'
 where slug = 'playoffs';
