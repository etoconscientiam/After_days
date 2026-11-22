# Layer engine rewrite — progress

Plan: `docs/ENGINE_PLAN.md`. Decisions (user, all as recommended): lateral thickness profile; archive zone with
epoch belts; soil as a skin on the surface; full rewrite (model + physics + renderer).

## Stage 1 — layer model next to the old one (done)

- `src/world/Strata.ts`: `Strata` = list of layers, top (youngest) first. A layer: id, years y0..y1, era,
  amounts per material **per segment** (12 segments of 15 px across the width: sea silt and land soil can lie side
  by side in one layer; local heat / press / groundwater act per segment), transformation progress per segment and
  material, resin-with-insect amounts, displayed rock + admixture per segment (decided only on events by
  `settleRock`, never per frame), one k, cached P/T, bones (x, depth inside the layer 0..1, species, decay, flags),
  open / belt / event kind, texture seed. Thickness profile = segment rows interpolated between segment centres.
- Converter `strataFromWorld` (cells + packs → layers): calendar bins (16 per era), thick bins (era walls, deep
  packs) cut into parts, then bins merged old → young while era and dominant rock stay the same and the layer is
  ≤ 24 rows. Keeps every material amount, every bone and fossil, k and progress.
- Save v2: `strata` in the blob (sparse amounts). A v1 save gets its layers from the converter on load.
  Until stage 2 the physics still runs on cells, so `Game.syncStrata()` rebuilds the layers before each save.
- Checks: `npx tsx tools/check/strata-convert.ts` (old saves in `tools/check/fixtures/`): material totals equal
  (diff 0.0000%), bones/fossils equal, save → load round trip equal, no layer thicker than 24 rows. In the browser
  three v1 saves (era II, IV, VII) load without console errors; the year span equals the old renderer's; saving
  writes v2 and it loads back. `npm run sim` output identical to the baseline (`baseline-sim.txt`, old build:
  finale 35.8 min, 2 prestiges).
- Notes for later: a late save has ~290 layers (deep ones from old packs are thin after compaction) — the archive
  zone of stage 3 merges them into epoch belts; strata save ≈ 570 KB at the finale (old world ≈ 500 KB, which goes
  away in stage 2).
