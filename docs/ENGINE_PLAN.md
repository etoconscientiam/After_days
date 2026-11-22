# Strata — layer engine rewrite (handoff for a new session)

Start here. This file is the whole context needed to continue: the project, the rules of work, what is wrong with
the current layer engine, the new design, and the stages with their checks. Talk to the user in Russian.

## 1. The request

The user (game owner) says the layer behaviour got too complex: the soil and the layers keep flickering and moving
in jerks. Earlier wishes that the new engine must satisfy:

- new layers accumulate **on top** (never appear inside the thickness); the soil on top, the geology and the
  topography change as deposits build up;
- the main thing is the accumulation of layers and what happens in the thickness: the screen and the events focus on
  the section (already: the section takes ~half of the screen; most rare events happen in the strata);
- compaction / transformation flashes must be small and local (already done: no line across a whole layer).

They asked to "think thoroughly about the logic and physics of the engine". The plan below was proposed and the user
agreed to restart in a new session with it. **Four decisions are still open — ask the user first (section 6);**
if they say "as you recommend", take the defaults.

## 2. Project in one screen

- «Слои» (Strata): vertical 9:16 idle/clicker, Vite 6 + TypeScript strict. Pixel world on a canvas 180×320
  (`WW`×`WH`, upscaled), smooth HTML/CSS UI «Камень и янтарь» in 360×640 units over it. en/ru i18n
  (`src/config/i18n/*.json`), configs in JSON (`src/config/*.json`, balance in `balance.json`).
- Headless core for a balance run: `npm run sim` (~2 min; one playthrough to the finale, now ≈36 game-minutes,
  2 prestiges). Typecheck: `npx tsc --noEmit -p .`. Dev: `npx vite --host 127.0.0.1 --port 5173`.
- Dev hooks in the page: `window.__strata` = { game, renderer, save, dev, drawer, input, modals, turmoil, away, lang }.
  `dev.jumpEra(n)`, `dev.timeScale`, `dev.skyFrozen`; in game: the beetle button (top left) opens the debug & cheats
  panel (`src/ui/debug.ts`), also the ` / ~ key.
- Key files:
  - `src/world/World.ts` — current data model: per column `x` (180) a stack of up to `CAP`=320 cells
    (mat, birth, k, P, T, prog, flags, spec, decay), oldest at i=0; when a column is full, the bottom rows of *all*
    columns fold into a full-width `Pack` (amounts per material, ageMin/ageMax, k, finds).
  - `src/core/deposition.ts` — per column deposition (`w.h` accumulator → one cell at a time, material picked per cell).
  - `src/core/geology.ts` — every 0.5 s: pressure, temperature, compaction k (all cells), transformations per cell
    and per pack, fossil rolls, organic rot in the top oxygen rows (random cells → soil), heat tracking
    (`g.hotNow/hotB/hotPacks` for the glow).
  - `src/core/game.ts` — tick: calendar `run.year` waits at an era's end until its condition is met, world time
    `run.clock` never stops (life, deposits, geology, effect timers use it). Species buying with displacement
    (`placeFor`), elements, rare events, press.
  - `src/core/elements.ts` — elements (rain, flood, drought, groundwater, heat, volcano, sea advance/retreat,
    earthquake → `run.faults`, glacier, meteor, magma); section targets are birth-year ranges + x range.
  - `src/core/forecast.ts` (Geologist forecasts per cell/pack), `src/core/rare.ts` (rare events; places
    sky/shore/land/section/strata/horizon, weighted), `src/core/prestige.ts` (epoch shift, foundation),
    `src/core/offline.ts`, `src/save/save.ts` (save format + migrate), `sim/sim.ts`.
  - `src/render/section.ts` — the section renderer (the part that flickers, see 3).
  - `src/render/renderer.ts` — the whole world frame: sky, sun/moon (rotation follows time speed), surface
    (relief `computeGround` + `updateSwell`), section overlays (glints, press flashes, settling grains, sparks, hot
    veins/glow `drawHot`, geologist overlay, rare events `drawRare`, burial marker), horizon and the thing + beam.
  - `src/render/common.ts` — `Layout` (surfaceTop 88, sectionTop 136, an open drawer crops the section: top at
    full scale + a history ribbon; `rulerW` strip at the right for the era ruler).
  - UI: `src/ui/geologist.ts` (lens button, lens, era ruler), `src/ui/input.ts` (tap = impulse, hold on strata =
    press, geologist taps), `src/ui/drawer.ts` (tabs), `src/ui/hud.ts`, `src/main.ts` (wiring, outside-tap closing of
    pop-ups, game loop).
- Look of rocks (keep it): painted 64×64 textures `world/tex/<material>.png` sampled in 2×2-pixel blocks, plus a
  pattern per rock family (`pattern()` in section.ts: grain, limestone blocks, clay cracks, coal glints, shale
  laminae, soil clods), 1–3 sprite inclusions per layer (ammonite, shell, bone, pebble, amber, roots), neighbours
  ≥ 22% apart in brightness, wavy edges, faults from earthquakes, belts of an epoch for merged thin layers.

## 3. Why the section flickers (diagnosis)

1. **Layers do not exist in the simulation; the renderer guesses them anew 20×/s.** `section.ts` bins all cells by
   birth year, picks the dominant material per bin, cuts runs, merges thin runs, splits beds, decides belts and
   tones. Every step is a threshold on values that drift all the time, so decisions flip. Hysteresis (memDom,
   memBounds, memBelt, memTone) only damps it.
2. **Everything is rescaled all the time.** Screen depth = log of the total visual depth (Σ 1/k). Every new cell and
   every compaction step (k of all cells grows every 0.5 s) shifts all boundaries by fractions of a pixel; after
   rounding each boundary jumps by 1 px at its own moment → jerks.
3. **The top boils in the data.** The material of each new cell is random; organic cells in the top rows randomly rot
   into soil every 0.5 s; transformations change single cells → the dominant rock of the top layer blinks
   ("мерцание почвы").
4. **Two worlds at depth.** A full column folds the bottom rows of all columns into a full-width pack at once (a jump
   at the bottom, lateral detail lost). Lateral box-blur couples neighbouring columns.
5. On top of that: relief swell, boundary waves and faults are recomputed every frame.

Measured with `tools/check/flicker.cjs` (pixels that go A→B→A over three 100 ms frames): 0.26% now (0.85% before the
last fixes). Target after the rewrite: **0**.

## 4. The new design

**Principle: a layer is an object of the simulation, not a guess of the renderer. The renderer only shows it.
Whatever moves, moves either as a whole (the whole thickness down) or as an explicit event.**

### Model
- The strata are a list of layers, top to bottom. A layer has: id; years from–to; rock (+ at most one admixture);
  raw thickness as a lateral profile (~12 control points, interpolated; thicker under the sea, dunes); one k, P, T
  per layer; transformation progress (per layer, or per x-segment when a local heat zone or a press acts);
  inclusions and fossils in layer coordinates (x, fraction of thickness, species, rare, fragment); flag "belt of
  epoch".
- The top layer is open: all deposits go into it (as amounts per material, not random cells). It closes and a new
  one opens when: the deposited rock changes steadily (N years), an element produces an event layer (flood silt,
  volcanic ash, moraine, meteor iridium), the era changes, or the layer reaches its max thickness. So new layers
  appear only at the top, by construction.
- Soil is not a layer: a skin on the surface whose look follows life (dusty crust / dark humus with roots / silt
  film under water). Organic rot is a fraction inside the open layer, not random cells.

### Physics (per layer, tick 0.5 s)
- Pressure = weight of the layers above; k grows; visual thickness = raw / k.
- Temperature by depth + heat zones (elements, magma).
- Transformation = progress per layer (or per segment); when done the rock of that layer/segment changes, one small
  sparkle. Rocks yield as now (`addRock`). Heat transformations drive the glow (`drawHot`).
- Press (hold on a layer) speeds k and progress for layers within the circle (segment).
- Earthquake shifts the profile of older layers in the data (a fault: offset + bend), erosion trims the top.
- Fossilisation: a chance per layer that holds bones (burial window multipliers stay).
- Era conditions, oxygen, life, energy — unchanged (they do not depend on cells).

### Screen (no constant rescaling)
- The top ~60% of the section is at a true scale (fixed px per raw row, possibly per era): new deposits push the
  whole thickness down — everything moves together, 1 px at the same moment, like a conveyor.
- Below is the archive zone: old layers at a fixed small height (≈6 px). When it overflows, older layers of one epoch
  merge into a belt of that epoch — once, with a short "compaction" animation, forever. A rare visible event instead
  of constant trembling.
- Displayed thickness eases toward the true one; offsets are applied in whole pixels to the whole stack at once.
- Keep: rock look, era ruler (spans from layers' years), lens, history ribbon over an open drawer, hot glow,
  Geologist overlay, rare events in the strata, faults, inclusions, fossils.

### What goes away
Year binning and dominant-rock guessing; threshold merges/beds/belts; all hysteresis maps; lateral blur; log scale of
the total depth; the double world of cells + packs; relief swell from fresh cells (relief comes from the open layer's
profile).

## 5. Stages (each ends with checks; commit after each)

1. **Layer model next to the old one** (`src/world/Strata.ts` or similar) + converter from saves (cells/packs →
   layers by years) so existing games survive; bump save version in `save.ts` migrate.
   Check: typecheck; load an old save in the browser (make one with the current build first) and compare layer
   count/years.
2. **Physics on layers** (deposition, compaction, transformations, fossils, press, elements, faults, prestige
   foundation, offline, forecasts). Check: `npm run sim` to the finale; compare era times, energy, rocks with the
   current numbers (finale ≈36 min, energy ~1e7–1e8, 2 prestiges) and keep them close.
3. **New renderer** (conveyor + archive zone + belts as events) replacing `section.ts` internals; remove the old
   pipeline. Check: `tools/check/flicker.cjs` → flickerBack = 0; screenshots of era I, III, VI, open drawer, lens.
4. **Hook up the rest**: input (press ranges by layer), Geologist overlay and lens, era ruler, rare events in strata,
   chronicle cards (`makeEntry` uses `Loc`), excavation depth / artifact, debug panel counters.
   Check: every feature by hand in the browser (Playwright scripts), no console errors.
5. **Report**: 30 s video (Playwright recording → ffmpeg), short Russian summary of what changed and what was
   simplified; rebuild the single-file page and republish.

## 6. Open decisions (ask the user; defaults in bold)

1. Layer thickness across the width: **a slowly changing profile (thicker under the sea, dunes)** or flat?
2. Depth: **archive zone with epoch belts** or the current smooth log scale?
3. Soil: **a skin on the surface** or a real top layer?
4. Scope: **full rewrite (model + physics + renderer)** or only the renderer on top of the cell model (cheaper, but
   causes 3–4 of the diagnosis partly stay)?

## 7. Rules of work

- Branch: `claude/fervent-archimedes-y90tch` only; push there (`git push -u origin <branch>`). No pull request unless
  the user asks.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <the new session's link>
  ```
  No model names in code, comments or docs.
- Single-file page for the user: `node tools/build-single.mjs` → `dist-single/strata.html`, then publish it to the
  existing artifact https://claude.ai/artifact/9rgRojSVwksg6TuDdB8fuw (Artifact tool, `url` = that link; read it
  first in a new session). Version 20 is the current one.
- Browser checks: Playwright is preinstalled (`require('playwright')`, `chromium.launch()`), iPhone 13 device,
  deviceScaleFactor 2 for pictures sent to the user. Freeze the sky for stills: `__strata.dev.skyFrozen = true`.
  `tools/check/flicker.cjs` needs the dev server on 127.0.0.1:5173.
- Don't touch without a reason: sky, clouds, creatures, the countdown, energy and resources, bottom menu, drawers and
  their content, Life cards, the thing and its beam, press and tap impulse, debug panel.
- Report screenshots go to `docs/<topic>/` (the user opens files from the repo).

## 8. Recent state (for orientation)

- Last commits: section focus + soil + strata events + steadier layers (f91885d); sea-era trap fix (displacement) +
  calendar grid layers + soft sparkles (317ba89); world clock + debug panel + sky speed + glowing sun (0322d62);
  pop-ups close on outside tap (b11fe2d); brief 6 readable section (cb64451).
- Known: the playthrough got shorter (≈36 min vs ≈45) since the era wall no longer wastes time; the surface band is
  narrow now and the header plates slightly overlap the hills. Briefs 4–6 and their reports are in the git history;
  brief 6 screenshots in `docs/brief6/`.
