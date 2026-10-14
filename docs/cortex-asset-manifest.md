# Cortex Asset Manifest

Phase 0 of the Cortex redesign, produced October 14, 2026. This manifest lists every image asset built in the art foundation wave, where it lives, what it depicts, and which surface uses it, so the engine coordinator can wire art by path without hunting. Every asset follows docs/cortex-style-guide.md and passed its pre ship checklist. All files are webp. Paths below are repo paths; on the served site, public maps to the root, so public/cortex/paths/path-body.webp answers at /cortex/paths/path-body.webp.

## Cast marking

Assets carry one of three cast marks.

* LEAD GUIDE: Pip, the one companion who travels everywhere, reacts, celebrates, and explains. Only the pose files below carry this mark.
* WORLD: scenes of the domain worlds, with no guide present. The key art and the openers carry this mark.
* CAMEO APPEARANCE: a scene in which a domain cameo appears inside its own domain. Cameos are specified in the style guide, section 8.3. No standalone cameo files exist in this wave; cameos appear inside world scenes, and the register at the end of this manifest records where.

## Lead guide assets: Pip poses

All six live in public/cortex/character/, are square at 1600 by 1600, and sit between 43 KB and 52 KB each. Pip in every pose: one Paper Cream pebble body, two Canopy Green arc tufts echoing the Cortex mark, one Amber Glow belly dot, one Clay Coral scarf, Warm Ink outlines, on a Paper Cream ground.

* public/cortex/character/pip-greeting.webp. LEAD GUIDE. Pip facing the learner, one stub arm raised in a wave, small open smile. Surfaces: the Cortex home header beside the streak, the daily return greeting, and the review warmup moment at the start of a review session. This file is also the consistency anchor for the whole pose sheet; future poses are generated against it.
* public/cortex/character/pip-celebrating.webp. LEAD GUIDE. Both arms raised high, eyes closed in happy arcs, three small amber spark marks in the air. Surfaces: the lesson complete celebration, unit finale wins, streak saves, and level ups.
* public/cortex/character/pip-thinking.webp. LEAD GUIDE. One arm curved up to the cheek, eyes lifted toward one small floating amber spark, mouth a small flat line. Surfaces: inside lessons at hard questions, the predict card pause, and the topic builder while a course is being made. Known note: the raised arm renders as a smooth cheek rest curve rather than a separate stub, and one eye carries a tiny extra flick. It reads clearly and stays; a future sheet pass may tidy it.
* public/cortex/character/pip-explaining.webp. LEAD GUIDE. One arm extended palm up, an empty pale speech bubble floating beside the hand, mouth open in a talking smile. Surfaces: the feedback sheet and every WHY explanation moment, plus the explainer beats in unit opener videos when those are built.
* public/cortex/character/pip-worried.webp. LEAD GUIDE. Arms held close together under the belly, wide eyes looking up at one single small low amber flame above, mouth a small wavy line. Surfaces: the streak at risk moment on the home screen and the map banner. One beat of care per the tone law in the style guide; it never appears twice in a row and never beside a demand.
* public/cortex/character/pip-fading.webp. LEAD GUIDE. Both arms cupped gently around a small amber spark that thins into rising dots, eyes soft and half lowered, mouth a small gentle line. Surfaces: the review due state, beside due counts in the review place, and with the map's fading state for reviews that are coming due. Known note: the cupped spark sits where the belly dot lives, so the pose reads as Pip gathering its own spark back. That reading suits the moment and is recorded here so nobody files it as an error.

## Path key art

One key visual per built in path, produced in the priority order the review panel set: the Human Body flagship first, then its unit openers, then the remaining paths. Key art surfaces for every file below: the path's tile on the map, and the header of the path home.

* public/cortex/paths/path-body.webp. WORLD, with CAMEO APPEARANCE. 1920 by 1280, 147 KB. The Human Body as a city of workers on a rounded warm island: a heart shaped pump house in Clay Coral at the center with two great pipes, Blood Clay roads winding through the city carrying round red delivery shapes with amber parcels, two pale bellows towers, scaffolding and small buildings, and the calm green control room on the hill at the back with messenger cables and amber sparks running down into the streets. The delivery shapes are the Courier Cell cameo at work (see the register).
* public/cortex/paths/path-science.webp. WORLD. 2736 by 912, 46 KB. How Science Works as a detective's bench: a wide haze taupe bench holding a magnifier with a starlight lens, three specimen jars (a leaf, a stone, a water drop), balanced weighing scales, a canopy green case folder tied with string, a green notebook, and one bench lamp pooling flat amber light across the right side. Known note: the composition is a banner strip with generous empty space above the bench, which suits header and tile use.
* public/cortex/paths/path-space.webp. WORLD, with CAMEO APPEARANCE. 1920 by 1280, 61 KB. Space and the Solar System as a dark sea with lit islands: Deep Sea water on a Night Ground frame, the lighthouse sun in Amber Glow on a rocky island pooling light on the water, a ringed island planet in green (the Ringed Island cameo), a coral planet with a great round spot, one small blue and green island, thin starlight orbit arcs as sea lanes, and sparse four point starlight stars. Serene throughout, per the domain rules.
* public/cortex/paths/path-earth.webp. WORLD. 1920 by 1280, 63 KB. Earth and Weather as a kitchen of air and water: an amber sun with short rounded rays, a deep sea lake resting over a warm amber glow at the land's edge, cream steam rising and swelling into two stacked cloud shelves (cream and haze taupe), the heavier shelf raining rounded drops onto green hills, and a deep sea river carrying the water back. The whole water cycle reads in one glance. Known note: the returning river reads partly as a second pond at its widest bend; the cycle still reads.

## Unit openers: the Human Body flagship

The Body path has two units in the shipped curriculum, and both openers are built, ahead of every other path's openers, per the flagship priority. Opener surfaces: the unit opener screen when a learner enters the unit, and the first lesson card of the unit until lesson level art replaces it.

* public/cortex/paths/path-body-heart-blood.webp. WORLD, with CAMEO APPEARANCE. 1920 by 1280, 59 KB. Opener for the unit The Heart and Blood. A closer view inside the body city: the great heart shaped pump house filling the left half with round portholes and an amber door, a broad Blood Clay road curving away carrying a single file stream of small round red delivery shapes with amber parcels (the Courier Cell cameo, close up), larger pale guard shapes drifting among them, and at the lower right one leaking green pipe being patched by two small dark repair shapes, one holding a wrench.
* public/cortex/paths/path-body-senses-nerves.webp. WORLD. 1920 by 1280, 48 KB. Opener for the unit Senses and Nerves. A green hill with the small calm control room at its top (round window, amber door), and halfway down the slope two sense houses: a white dome with one big deep sea iris for the eye, and an amber form with a clay coral spiral for the ear. Thin cables wind from both houses up the hill with amber sparks traveling along them, and a few rooftops below suggest the city the messages serve. Production note: this file is the second, clearer generation; an earlier, more abstract version was replaced before shipping and is not in the tree.

## Lesson art: the Human Body flagship (Phase 2, 2026-10-14)

The flagship rebuild gave the Body path six units and 37 stops, and every regular lesson now opens its teaching with lesson level art: the card 2 visual of each lesson, plus a mechanism visual on card 4 where the mechanism is spatial. The two unit openers above are reused inside the new structure (the heart and blood opener teaches the heartbeat lesson; the senses and nerves opener teaches the neurons lesson), and the path key art carries the capstone's image question. All 35 files below were generated at 1920 by 1280 and compressed for delivery to 1024 wide webp; the whole set is 1.57 MB. Cast mark is WORLD throughout; the Courier Cell cameo appears at work inside several scenes, as city traffic. Surfaces are named per file.

Unit 1, Cells:

* public/cortex/lessons/body/u1-l1-cell.webp. 31 KB. One large round green cell with its center spot, delivery roads and courier shapes around it. Surface: The smallest living thing, card 2 visual and its image question.
* public/cortex/lessons/body/u1-l2-cell.webp. 28 KB. A plump round cell in its membrane ring, parcels arriving at its edge. Surface: Inside a cell, card 2.
* public/cortex/lessons/body/u1-l2-inside.webp. 46 KB. Cutaway inside one cell: the round control center in the middle, bean shaped power stations around it. Surface: Inside a cell, card 4 mechanism and its image question; reused by the Cells checkpoint image question.
* public/cortex/lessons/body/u1-l3-delivery.webp. 40 KB. A Blood Clay road carrying delivery shapes with amber parcels toward a waiting cell. Surface: How cells eat and breathe, card 2.
* public/cortex/lessons/body/u1-l4-divide.webp. 34 KB. One cell stretched and pinched in the middle, two centers inside. Surface: How cells divide, card 2.
* public/cortex/lessons/body/u1-l4-splitting.webp. 28 KB. Two round cells just after splitting, each with its own center. Surface: How cells divide, card 4 mechanism and its image question.
* public/cortex/lessons/body/u1-l5-tissues.webp. 88 KB. Rows of identical round cells joined edge to edge as one sheet. Surface: How cells team up, card 2.

Unit 2, Fuel:

* public/cortex/lessons/body/u2-l1-lungs.webp. 75 KB. Two pale bellows towers joined by a tube, air puffs drifting in over city rooftops. Surface: Breathing and the lungs, card 2.
* public/cortex/lessons/body/u2-l1-diaphragm.webp. 37 KB. Two sponge lung shapes above one wide curved sheet of muscle. Surface: Breathing and the lungs, card 4 mechanism and its image question; reused by the Fuel checkpoint image question.
* public/cortex/lessons/body/u2-l2-blood.webp. 45 KB. A stream of round red delivery shapes with amber parcels, pale guards among them, platelet discs at the edges. Surface: Blood as a delivery system, card 2 and its image question.
* public/cortex/lessons/body/u2-l4-digestion.webp. 46 KB. The disassembly line: a chopping station, a churning pot, one long winding tube. Surface: Digestion, card 2.
* public/cortex/lessons/body/u2-l5-energy.webp. 54 KB. A city power station with delivery cells, a warm amber center, and full storage barrels. Surface: Where your energy actually comes from, card 2.

Unit 3, Control:

* public/cortex/lessons/body/u3-l2-reflex.webp. 48 KB. A hand pulling back from a warm coral pan, an amber spark running up the arm. Surface: Reflexes, card 2.
* public/cortex/lessons/body/u3-l2-arc.webp. 39 KB. The messenger tower: a spark enters at the base, turns at a round platform, and races back down. Surface: Reflexes, card 4 mechanism and its image question; reused by the Control checkpoint image question.
* public/cortex/lessons/body/u3-l3-brain.webp. 51 KB. The control room on its hill, its inside divided into colored rooms, green cables running down. Surface: The brain's regions, card 2.
* public/cortex/lessons/body/u3-l4-hormones.webp. 52 KB. A slow Blood Clay river carrying sealed message bottles past round cells. Surface: Hormones, card 2.
* public/cortex/lessons/body/u3-l5-sleep.webp. 29 KB. The body city at night: dimmed control room, repair crews by lamplight, a starlight crescent. Surface: Sleep, card 2.

Unit 4, Defense:

* public/cortex/lessons/body/u4-l1-skin.webp. 60 KB. The great warm brick wall of the city, guards walking its top, green germ shapes kept outside. Surface: Skin and barriers, card 2.
* public/cortex/lessons/body/u4-l1-layers.webp. 55 KB. The skin stack from the side: shedding top layer, busy middle with sensor posts, springy base. Surface: Skin and barriers, card 4 mechanism and its image question; reused by the Defense checkpoint image question.
* public/cortex/lessons/body/u4-l2-immune.webp. 48 KB. Pale guard shapes patrolling, one wrapping a spiky green germ. Surface: Immune cells, card 2.
* public/cortex/lessons/body/u4-l3-fever.webp. 39 KB. Heat waves rising over rooftops, guards hurrying, one amber sun (which carries a small thermometer shape inside it; noted, kept). Surface: Fever and infection, card 2.
* public/cortex/lessons/body/u4-l4-vaccine.webp. 50 KB. Guards studying a harmless ribboned practice dummy, note boards in hand. Surface: Vaccines, card 2.
* public/cortex/lessons/body/u4-l5-allergy.webp. 51 KB. Guards surrounding one soft pollen puff, sneeze puffs in the air. Surface: When defense goes wrong, card 2.

Unit 5, Movement:

* public/cortex/lessons/body/u5-l1-bones.webp. 53 KB. Cream scaffolding towers and a rib cage around a small heart house, workers climbing. Surface: Bones, card 2.
* public/cortex/lessons/body/u5-l2-muscles.webp. 44 KB. Crane like coral muscles tied by cables to cream bone beams. Surface: Muscles, card 2.
* public/cortex/lessons/body/u5-l2-lever.webp. 46 KB. Two cream arm bones at a hinge, a coral muscle above pulling the lower bone up. Surface: Muscles, card 4 mechanism and its image question; reused by the Movement checkpoint image question.
* public/cortex/lessons/body/u5-l3-joints.webp. 41 KB. Connector close ups: a pin hinge and a ball in a cup with fluid drops, under a city scene band. Surface: Joints, card 2.
* public/cortex/lessons/body/u5-l4-growth.webp. 65 KB. A scaffolding tower growing taller, soft green top, workers adding pieces. Surface: Growth, card 2.
* public/cortex/lessons/body/u5-l5-healing.webp. 50 KB. Repair crews patching a cracked wall with planks and sealant. Surface: Healing, card 2.

Unit 6, Senses:

* public/cortex/lessons/body/u6-l1-sight.webp. 37 KB. The eye house with its big Deep Sea iris window, straight light rays entering. Surface: Sight, card 2.
* public/cortex/lessons/body/u6-l1-eye.webp. 43 KB. Inside the eye house from the side: rays through the lens landing on the back wall in spark dots. Surface: Sight, card 4 mechanism and its image question; reused by the Senses checkpoint image question.
* public/cortex/lessons/body/u6-l2-hearing.webp. 34 KB. The amber ear house with its coral spiral, sound waves arriving, the drum at its side. Surface: Hearing, cards 2 and 4 and its image question.
* public/cortex/lessons/body/u6-l3-flavor.webp. 42 KB. A bumpy tongue and a nose house sharing scent puffs from a bowl. Surface: Smell and taste, card 2.
* public/cortex/lessons/body/u6-l4-touch.webp. 39 KB. Rolling skin ground with sensor posts, one tall crowded cluster on a fingertip hill. Surface: Touch and pain, card 2.
* public/cortex/lessons/body/u6-l5-illusions.webp. 37 KB. The control room atop the body city, tiny workers assembling a picture from jigsaw pieces, gaps still showing. Surface: How the brain fills in, card 2. Production note: the planned subject, two towers of exactly equal height in different size contexts, failed three generations (the towers kept landing measurably unequal, which the style guide's no lying proportions law forbids on a lesson about illusions), so the shipped visual is the builder brain subject instead; the image question for that lesson is answered from its diagram, as planned.

## Cameo register

* The Courier Cell (the Human Body): appears as the delivery traffic in public/cortex/paths/path-body.webp and close up in public/cortex/paths/path-body-heart-blood.webp.
* The Ringed Island (Space and the Solar System): appears in public/cortex/paths/path-space.webp.
* The Old Pebble (Earth and Weather): specified in the style guide, with no appearance yet. Its first appearance belongs to Earth lesson art in the content wave.

## Production notes for the engine coordinator

* Wire by the exact paths above. No asset needs renaming, and no other files were left in the two asset folders.
* Every image honors the no text law: nothing is baked in, so all labels, titles, and captions belong to the interface layer, in the app font, beside the art.
* The pose files are square and the scenes are wide (three by two, science three by one). Crop with the focal subject in mind: Pip centered, the pump house left of center in the heart opener, the lighthouse sun centered in the space scene.
* Total art weight for the whole set is under 750 KB, so the full cast and all four path visuals can ride along with the first load of the redesigned home without a loading strategy of their own.
* The next art needs, in the order the plan implies: unit openers for the other three paths, teach visuals for the Body path lessons (the flagship content wave), and the Old Pebble's first scene.
