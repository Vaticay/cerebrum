# Cortex Style Guide

The complete art direction for Cortex, the learning section of Cerebrum. Phase 0 of the Cortex redesign, written October 14, 2026. Every illustration, animation, key visual, and character pose made for Cortex follows this guide. If an asset disagrees with this guide, the asset is wrong, not the guide. Changes to this guide happen in one place, here, and every surface inherits them.

## 1. What the art is for

Cortex teaches science in plain language, first with teaching, then with fair quizzes, then with spaced review. The art exists to carry the teaching. A Cortex visual is never decoration placed next to an idea. The visual is the idea, drawn. A learner who looks at the image before reading a single word should already be able to guess what the lesson is about, and a learner who has read the lesson should be able to look at the image and remember it.

The reference points are the two the redesign plan names. From Imprint: every idea arrives as a designed visual first and words second, and the art is consistent enough to be recognized in one glance. From Duolingo: a world you travel through, a character you travel with, and small bright moments of reward. Cortex takes both, and keeps its own moat: nothing in the art may invent a fact. If a shape, a color, or a motion would teach something untrue, it does not ship, however pretty it is.

## 2. The illustration language

One language for everything: lessons, maps, key art, the character, celebration moments, and share cards.

* Flat shapes only. Every form is a simple, bold, rounded shape filled with one matte color. No gradients anywhere. No drop shadows, no glows, no blur, no texture overlays, no photographic elements.
* One outline voice. Shapes carry a clean outline in Warm Ink (see the palette) at one consistent weight relative to the canvas. Outlines are warm dark brown, never pure black, never gray.
* Simple geometry. Circles, arcs, rounded rectangles, and soft triangles do almost all the work. If a subject cannot be drawn with these, simplify the subject until it can. A simple true shape beats a detailed doubtful one.
* Limited elements. One idea per image, one focal subject, and as few supporting elements as the idea allows. Busy images teach slowly.
* Generous negative space. The ground around the subject is part of the composition. Crowded art reads as noise at phone size.
* Matte and quiet. Colors are the palette below, at full strength, never neon, never pastel washed. The parent brand is dark and calm; the art is the warm room inside it.
* Rounded everything. Corners, ends, and joins are rounded. Nothing in Cortex art has a sharp point except where the science itself is sharp, such as a crystal edge or a beak, and even then the point is softened.
* The same world at every size. A visual drawn for a teach card and the key art for its path use the same shapes, the same palette, and the same metaphors, so a learner moving from card to map never leaves the world.

## 3. The palette

### 3.1 Where the palette comes from

The illustration palette is derived from the colors Cortex already ships, warmed two steps. The anchors are the Sage palette in src/palettes.js (the fresh browser default: background #0d0f0e, surface #151816, raised #1e221f, ink #f4f7f4, faint #94a397, accent #8ba888), the Amber accent #d9a441 from the same file, the Light palette paper tones (background #f1f0ec, surface #f9f9f7, ink #22252a), and the two blues the Cortex player already uses for a chosen answer (deep #274b63, pale #DDF4FF), plus the ember orange #fb923c in the Pro Ember palette line.

One warming step means: rotate the hue a few degrees toward amber, lift the lightness slightly, and give any gray a warm brown or warm green cast. Two steps, applied to each anchor, produce the working palette below. These derived hex values are now the canonical art colors. Product interface colors stay exactly as the code has them; this palette governs artwork only, and it was built to sit comfortably on both the dark Sage surfaces and the Light paper surfaces the app already offers.

### 3.2 The working palette

* Paper Cream #F5EFE2. Derived from the Light surface #f9f9f7, warmed two steps toward cream. The light ground for artwork, the character body color, clouds, steam, paper, and bone. Art that lives on a card usually sits on Paper Cream.
* Warm Ink #2A2620. Derived from the Light ink #22252a, warmed two steps. The outline color for everything, and the color of eyes, feet, text free symbols, and deep shadow shapes. Never pure black.
* Night Ground #1C1A15. Derived from the Sage background #0d0f0e, warmed two steps. The dark ground: space scenes, night scenes, and any artwork that needs the parent brand's dark calm behind it.
* Canopy Green #7FAE72. Derived from the Sage accent #8ba888, warmed two steps toward yellow green and deepened slightly so it holds as a flat fill. The primary brand green of the art system. The character's tufts, method accents, leaves, and go signals.
* Leaf Bright #A8C686. Canopy Green lifted in lightness, its younger sibling. New growth, highlights on plants, shallow water sparkle, and the living world at its freshest.
* Amber Glow #E0A83E. Derived from the Amber accent #d9a441, warmed two steps toward orange and brightened slightly. Sparks, sunlight, lamplight, celebration, and the character's belly dot. Amber Glow is the reward color: wherever it appears, something good or important is happening.
* Clay Coral #E07856. Derived from the ember orange #fb923c, warmed two steps toward red clay and deepened for matte fills. Heat, the body, effort, and gentle alarm. The character's scarf is Clay Coral, which makes the character findable in any scene.
* Blood Clay #C24B3F. Clay Coral deepened. Blood, muscle, and the working interior of the body city. Used with restraint: it is the strongest color in the palette.
* Deep Sea #274B63. Taken unchanged from the Cortex player, where it already marks a chosen answer in dark themes. Water at depth, the space sea, distance, and cool shadow.
* Starlight #DDF4FF. Taken unchanged from the Cortex player, its pale counterpart. Stars, ice, glints, highlights on water, and anything that shines in the dark.
* Haze Taupe #A79B87. Derived from the Sage faint #94a397, warmed two steps. Rock, dust, old paper, benches, and neutral mid tones that should not compete with the subject.

### 3.3 Palette discipline

* At most five palette colors in a single teach visual, plus Warm Ink outlines and the ground. Key art may use up to seven.
* Every image has one dominant color family, and it is the family of its domain (see section 5). A learner should be able to name the domain from the colors alone.
* Amber Glow and Blood Clay are rationed. Each appears in at most one focal place per image. Scarcity is what makes them read as important.
* No color outside this palette in finished art. If a subject seems to need a new color, the subject gets simplified or the palette gets amended here, in writing, first.
* Contrast law: Warm Ink outlines and shapes must stay readable on both Paper Cream and Night Ground versions of a scene. Key art is drawn as a lit scene on its domain ground (Paper Cream for the warm domains, Night Ground for the space sea) and placed on the dark map as a lit tile, so a path on the map reads as a bright place in a dark world.

## 4. Typography and lettering

* The app speaks in the font stack the product already defines in index.html: Inter Tight first, then Inter, then the system sans. Artwork inherits this voice by never competing with it.
* No text inside images. No letters, no words, no numerals, no labels, no signage, no captions baked into a picture. Words live in the card, where they can be read aloud by a screen reader, resized, translated, and tested by the quiz engine. A picture that needs a word inside it is the wrong picture.
* The single exception is the Cortex mark itself, the two folded arcs around a point, which carries no letters and may appear as a drawn shape inside scenes, the way a flag or a badge would.
* Where a diagram would normally carry labels, the visual uses position, color, and the card layout instead: the label sits in the interface beside or beneath the image, in Inter Tight, and the image element it names is drawn in the domain accent so the pairing is obvious.
* Numbers follow the same rule. Counts are shown by drawing the things themselves, up to a small group. A flock, a crowd, or a pile is drawn as a texture of simple shapes, never as a numeral.

## 5. The domain worlds

Each science domain is one recurring place with one governing metaphor. The metaphor is not a garnish; it is how the domain is drawn every time, so learners build a mental map of where a fact lives. When a new lesson arrives in a domain, its visuals are set in that domain's world, with that domain's cast of shapes.

### 5.1 The Human Body: a city of workers

The body is a busy, well run city, and every organ is a crew doing one job for the whole city.

* The heart is the pumping station at the center, drawn as a round, tireless pump house with two big pipes. Blood vessels are the city's roads and rivers in Blood Clay, widening and narrowing with the traffic.
* Red blood cells are delivery workers carrying round amber parcels of oxygen, traveling in single file streams. White blood cells are the city's guards, larger, paler, unhurried. Platelets are repair crews with planks and sealant at a leak.
* The lungs are two great bellows towers at the city's edge, rising and settling. The stomach is the kitchen depot where deliveries are sorted. Bones are the city's scaffolding and towers; muscles are the cranes and cables that move them.
* The brain is the quiet control room on the hill: few shapes, calm colors, everything else reports to it. Nerves are messenger lines drawn as thin Canopy Green cables with sparks of Amber Glow traveling along them.
* Rules for this world: crews are simple rounded worker shapes, never realistic anatomy, never gore. Interiors are warm (Clay Coral leads, Blood Clay supports, Paper Cream for lit surfaces). Nothing in the body city is frightening; even germs are drawn as scruffy intruders the guards can handle.

### 5.2 Space and the Solar System: a dark sea with lit islands

Space is a calm dark sea at night, and every world is a lit island in it.

* The ground is always Night Ground, the sea is Deep Sea, and light is Starlight and Amber Glow. This is the one domain drawn on the dark ground by default.
* Planets are islands: round, banded with simple horizontal shapes, each with one distinguishing silhouette (rings, a great spot, a tilt). The Sun is the lighthouse at the center, the largest Amber Glow shape in the system, drawn with short rounded rays.
* Orbits are the sea lanes: thin Starlight arcs, calm and unbroken, with a small wake where a planet travels. Gravity is the slope of the sea itself, shown by lane arcs bending toward large islands.
* Stars are harbors far away: small four point Starlight sparks, identical in shape everywhere, so a learner reads them as distance, not decoration. Comets are travelers with a short tail of pale shapes. Telescopes and satellites are little boats and buoys with one blinking Amber Glow light.
* Rules for this world: space is serene, never a battlefield. No explosions as spectacle, no sharp shards. Motion here is the slowest in the system.

### 5.3 Earth and Weather: a kitchen of air and water

Weather is a working kitchen where air and water are cooked, carried, and served, and the land is the table it all happens on.

* The Sun is the stove: an Amber Glow burner beneath or above the scene, and heat is drawn as gentle rising wavy shapes in pale coral, always moving upward.
* Water is Deep Sea when deep and Leaf Bright at bright surfaces. Evaporation is steam: Paper Cream puffs rising off a warmed surface, swelling as they climb. Clouds are the kitchen's hanging shelves, stacked rounded Paper Cream shapes holding water until they grow heavy and gray with Haze Taupe.
* Rain is the serving: simple rounded drops falling in loose rhythm. Rivers are the drains and channels that carry everything home to the sea. Ice and snow are Starlight shapes at rest.
* Air is the cook you cannot see: shown only by what it moves (steam bending, cloud shelves drifting, a flag of plain shapes leaning). Wind is never drawn as swirls with faces.
* The plates of the Earth are the table's great slabs: Haze Taupe blocks that drift, crumple at the edges into mountains, or slide one beneath the other, with the kitchen resting calmly on top, unaware.
* Rules for this world: every weather visual shows cause as a physical setup in the scene (a heat source, a height, a slope), never as arrows and labels. If the cause cannot be drawn as a thing, the visual is not finished.

### 5.4 How Science Works: a detective's bench

Method is a detective's workbench, where questions are cases and evidence is handled with care.

* The bench is a warm wooden surface in Haze Taupe and Warm Ink, lit by one Amber Glow lamp. On it: a magnifier (a circle of Starlight with a Warm Ink handle), specimen jars in Paper Cream with simple contents, a notebook drawn as a plain rectangle with a Canopy Green cover, and weighing scales for fair comparisons.
* A question is an unopened case folder in Canopy Green, tied with string. A claim is a card placed face up on the bench. Evidence is a small physical token (a jar, a stone, a leaf, a measured strip) placed beside the claim it supports.
* A fair test is two identical setups side by side with one difference between them, drawn so the one difference is findable at a glance. Replication is the same bench drawn again, identical, with a second detective's lamp lit beside the first.
* Results are the lamp brightening: supported ideas sit in Amber Glow light; ideas that failed sit in plain Paper Cream light, unshamed. Science in this world corrects itself on the same bench, openly.
* Rules for this world: no white coats, no bubbling flasks of glowing liquid, no mad energy. The bench is calm, honest, and a little worn, because method is a habit, not a performance.

### 5.5 The Living World: a great tree of neighborhoods

The living world is one great branching tree, and every branch is a neighborhood where related households live. This path is planned as the first expansion of the catalog, and its world is specified now so its art arrives consistent.

* The tree itself is Canopy Green and Warm Ink, drawn with rounded branching forks, never jagged. Close kin live on nearby twigs; distant kin share only the deep branches. The trunk is deep time: the oldest shapes sit lowest and plainest.
* Each kind of living thing is a household on its branch: one simple silhouette per kind, repeated with small variations, living in a nest, burrow, or pool drawn in the same simple shapes. Households that change over time are drawn with their older form as a faint Haze Taupe shape behind the current one, like a grandparent portrait on the wall.
* The ground beneath the tree is a garden in Leaf Bright and Paper Cream, where the small cycles live: seeds, rain, fallen leaves returning to soil. Predators and prey are neighbors in this world, drawn at honest sizes, never as monsters and never as villains.
* Change over generations is shown by a row of households along one twig, each a little different from the last, the differences small enough to spot one at a time.
* Rules for this world: living things are drawn with respect and accuracy of proportion where proportion is the lesson. Nothing is cute at the cost of being wrong. Species are never mixed into invented hybrid creatures.

## 6. The imagery laws

These laws bind every still image Cortex ships, in lessons, on the map, in key art, and in share cards. They come from the redesign plan, and the outside review panel confirmed them.

* The visual carries the idea. A teach visual must be answerable from: a learner who studied only the picture should be able to guess the point of the card. Decoration beside an idea is a failed visual, however handsome.
* No text inside images. Letters, words, labels, and numerals live in the interface, never in the art (see section 4).
* No visual gives away a quiz answer. Teaching art may show an idea fully, because teaching comes before quizzing. But art shown at question time, and opener art for a unit whose finale tests the idea, must set the scene without revealing the tested fact.
* No stock mood shots, and no visual that could sit on any lesson. If an image would work equally well in a different domain, it belongs nowhere.
* Nothing invented. No hybrid creatures, no false anatomy, no proportions that lie where proportion is the lesson. The art simplifies; it never fabricates.
* The science stays the subject. Pip appears in opener art, celebration art, and at the edge of scenes as the traveling companion. Inside a teach visual, the domain cast demonstrates the idea and Pip stays out of the way or out of the frame.
* Warm and light, always. Even germs, leaks, and failing claims are drawn calmly. No image in Cortex frightens, shames, or hurries the learner.

## 7. The production pipeline

Art is produced as a pipeline, not as one off pieces, because the catalog needs hundreds of visuals that all look like one world.

* Specify. Every visual begins as a line in the lesson data: subject, domain metaphor, composition, and the palette colors allowed. No specification, no generation.
* Generate to the guide. The style block from this guide (flat shapes, Warm Ink outlines, matte palette colors, no text) travels with every generation request, together with the domain section that governs the scene.
* Review at the gate. Every asset passes the checklist in section 10 before it is stored. Consistency beats quantity: a drifting asset is regenerated, not excused.
* Store with the course. Finished art lives under public/cortex in the folder for its kind (character, paths, and later lessons), in webp format, at a size a phone can afford, and is entered in the asset manifest with its surface named.
* Reuse before redrawing. The recurring casts of each domain world (the delivery cells, the island planets, the cloud shelves, the bench tools) are drawn once as approved shapes and reused, so the marginal visual stays cheap and the world stays itself.

## 8. The cast: one lead guide, and cameos in their domains

The outside review panel (Claude, Grok, and Asta, reviewing one identical brief) settled the character question, and this guide adopts their consensus in full: one lead guide character who reacts, celebrates, and explains, plus domain cameo characters who appear inside their own domains rather than everywhere. Assets are marked in the manifest as lead guide assets or cameo assets, and the two kinds never blur.

### 8.1 The tone law

The guide is a companion, not a nag. The tone of every character moment is light and warm, never childish, and never driven by guilt. Pip is pleased when you arrive, philosophical when you have been away, and honest when an idea is hard. Pip never sulks, never threatens the streak, never counts what the learner owes. Worry, when it appears at all, is Pip caring about something fragile, and it lasts one beat before turning back into encouragement. This law binds poses, animations, notification copy, and every word spoken beside the character.

### 8.2 Pip, the lead guide

Name proposals, considered in the open:

* Pip. A pip is a small seed and a small dot, and the Cortex mark is two folded arcs around a point. The name is the point in the mark, ready to grow.
* Lumen. Beautiful, and a real word for light, but it is a unit of measure and reads clinical beside a companion.
* Mote. A mote is a speck of dust. It reads as a flaw, and the companion must never read as a flaw.
* Fern. Warm, but it locks a character who travels through space and blood to the plant world.
* Nova. Loud, space bound, and a promise of explosion. The tone law forbids the energy it advertises.

The pick is Pip, for three reasons. It is the point in the Cortex mark, so the character and the logo are one idea. It is short enough to say in any language and kind enough to say to a child or a professor. And a pip is a beginning: a seed is exactly what a fact is before the review system grows it.

Personality, in three lines:

* Curious first: every new thing is worth one closer look.
* Steady company: glad when you show up, unbothered when life gets in the way.
* Honest about hard parts: a tricky idea gets a slower pace and a plainer explanation, never a fake cheer.

What Pip is, drawn:

* One single round pebble shaped body in Paper Cream #F5EFE2, slightly wider than tall, with no separate head. The body is the point of the mark, grown legs.
* Two folded arc tufts on top of the body in Canopy Green #7FAE72, curved like the arcs of the mark leaning toward each other. The tufts are the silhouette: Pip must be recognizable from the tufts alone.
* Two large oval eyes in Warm Ink #2A2620 with small cream highlights, and a small simple mouth. No nose, no eyebrows, no hair.
* One single round dot in Amber Glow #E0A83E at the center of the belly: the held spark, the fact being carried.
* Two tiny rounded stub arms in Paper Cream with Warm Ink outlines, and two tiny Warm Ink oval feet at the base.
* One small scarf in Clay Coral #E07856, wrapped once around the lower body with one short tail. The scarf is Pip's traveling gear and the warmest findable note in any crowd scene.

Consistency rules, so Pip stays Pip:

* Invariants, which never change in any pose, scene, or animation: body color and pebble shape, the two green arc tufts, the amber belly dot, the coral scarf, the eye style, the outline weight, and the proportions (body about as wide as tall, tufts about a third of body height, belly dot about a tenth of body width).
* Expression is carried by the eyes, the mouth, and the arms only. Open oval eyes for attention, upward arc eyes for joy, soft half lowered eyes for tenderness, wide eyes for concern. The mouth stays small in all of them: smiles, one flat gentle line, one small wavy line for worry, one small open oval for explaining. Pip never shows teeth, never frowns deeply, never cries.
* Pose vocabulary is small on purpose. New poses join the sheet only when a product moment needs one and this guide records it.
* Pip is drawn at companion scale: in scenes, about the height of a door in the body city, a small boat beside the island planets, a figure at the bench. Pip never looms over the science.
* Rank kit may grow, per the redesign plan's levels: at higher learner ranks Pip gains small earned gear (a satchel, a bench lamp, a tiny telescope), added at the back or the side, never covering the tufts, the face, or the belly dot. The base invariants hold at every rank.
* Misuse: Pip is never flattened into the logo (the mark stays the mark), never drawn realistically, never given clothes beyond the scarf and earned kit, never placed in another product's colors, and never used to sell anything inside a lesson.

Pose coverage for the daily loop, as built in this phase (file names in the manifest):

* Review warmup greeting, and the first greeting of the day generally: the greeting pose, one arm raised in a wave.
* Thinking, mid lesson: the thinking pose, one arm at the cheek, eyes lifted to one small spark.
* Explaining, for feedback and the WHY moments: the explaining pose, one palm up, an empty speech bubble beside the hand.
* Lesson complete celebration, also streak saves and level ups: the celebrating pose, both arms high, sparks around.
* Streak at risk worry: the worried pose, arms close, eyes up at one small low flame of a spark. One beat of care, per the tone law.
* Review due, the fading memory reaction: the fading pose, both arms cupped around a spark that is thinning into dots. This pose pairs with the map's fading state for due reviews: the memory is pictured as light that can be gathered back by reviewing, which is exactly what the review system does.

### 8.3 Cameo characters

Cameos are residents. Each cameo lives in one domain, appears only there, and demonstrates ideas inside scenes. Cameos never address the learner, never explain, never travel, and never appear on the home screen or the map as guides. Explaining is Pip's job alone; a cameo's job is to be the science, caught in the act.

Cameo design rules:

* A cameo is one simple silhouette in its domain palette, with at most two dot eyes in Warm Ink when a face helps the demonstration. No scarf, no belly dot, no arc tufts: those belong to Pip, and their absence is how a learner tells a resident from the guide at a glance.
* A cameo recurs with the same silhouette every time it appears, so learners build recognition the way they do with Pip.
* A cameo may be given a production name inside this guide for the writers and artists. Learners meet cameos by their science names in lesson text.
* New cameos are approved into this guide before production, one per domain at a time, and only when several lessons will use them.

The founding cameos, named by the review panel's own examples:

* The Cell, in the Human Body. A plump round delivery shape in Blood Clay #C24B3F with a paler center, carrying one amber parcel. The Cell knows every road in the body city and demonstrates carrying, delivery, and leaks. Production name: the Courier Cell.
* The Planet, in Space and the Solar System. The ringed island planet, banded in Deep Sea and Starlight with its wide flat ring, unhurried at the center of its sea lane. The Planet demonstrates orbits, seasons by tilt, and distance. Production name: the Ringed Island.
* The Rock, in Earth and Weather. A round Haze Taupe #A79B87 pebble, visibly worn smooth, older than everything else in the scene. The Rock demonstrates deep time, erosion, and the patience of the plates. Production name: the Old Pebble.

## 9. Video and the motion rigs

Video and animation belong in exactly three places, per the redesign plan: the teach moment for ideas whose whole point is motion; the opener of a new unit, about fifteen seconds that makes the unit feel like a place; and the celebration layer, where Pip moves at streak saves and level ups. Nowhere else. Motion is produced as templated rigs that lesson data drives, never as bespoke film per lesson.

Three laws bind every moving asset:

* The fact law. No quiz fact may live only in video. Every fact a quiz needs is also taught as text on a teach card. A learner who skips every video loses nothing testable.
* The replacement law. Video never replaces a teach card. It sits beside the card, showing the motion the words describe.
* The caption law. Moving assets are silent friendly: the idea must be fully readable with the sound off. All words travel in captions set in the interface in the app font, never baked into the picture. Faces, where present, follow the same expression vocabulary as the still poses.

The five rigs:

* Orbit. What it shows: one body circling a center on a calm arc: a planet around the lighthouse sun, a moon around its island, a satellite around a world. Duration: one full circuit in 12 to 20 seconds, slower for larger bodies. Loop: seamless, with the moving body crossing the join at the far side of the circuit where the eye rests least. Teaches: revolution, periods, why the same face of a moon can stay toward its planet.
* Flow. What it shows: a stream of shapes traveling one path: delivery cells along a blood road, sparks along a nerve cable, water along a river, air over a surface. Duration: 10 to 18 seconds for one shape to travel the visible path. Loop: a continuous stream with no visible join, because the stream never empties. Teaches: circulation, conduction, currents, anything with a route and a cargo.
* Grow. What it shows: one thing becoming more: a cloud swelling and darkening, a shoot rising, ice spreading across a pond, a row of households lengthening. Duration: 10 to 15 seconds from the start state to the end state. Loop: holds the end state for two seconds, then settles gently back to the start; the return reads as a reset of the demonstration, and no lesson may describe the real process as running backward because the loop does. Teaches: accumulation, growth, phase change, slow build ups.
* Collide. What it shows: two things meeting and the honest result: two Haze Taupe slabs crumpling at their edges into mountains, a dropped ball meeting the ground, two crowds of shapes meeting in the method kitchen of air. Duration: 8 to 14 seconds, including a one second hold before contact so the learner can predict. Loop: the pieces ease back to their start positions through a soft settle, ready to meet again. Teaches: plate movement, impact, mixing, cause meeting effect.
* Cycle. What it shows: a closed circuit of stages with the same shapes throughout, so the eye can follow one parcel all the way around: the water cycle above the kitchen table of the land, the blood loop out of the pump house and home again, a rock's long road from mountain to sediment and back. Duration: 15 to 25 seconds for the full circuit. Loop: truly endless; the final stage hands its shapes to the first without a seam. Teaches: every system whose point is that it comes back around.

Rig production rules: lesson data names the rig, the subject shapes from the domain cast, and the path; the rig renders the motion in the domain palette with Warm Ink outlines, flat and matte like the stills. Character animation for the celebration layer reuses the pose sheet's Pip with small movements (a hop, arms rising, the scarf tail swinging), drawn from the same invariants in section 8.2.

## 10. The pre ship review checklist

An asset ships only when every line below is true. The reviewer checks the asset, not the intention.

* Flat matte shapes only, one consistent Warm Ink outline voice, no gradients, no shadows, no photographic material.
* Only palette colors, with the domain family dominant and Amber Glow and Blood Clay each in at most one focal place.
* One idea, one focal subject, generous negative space, readable at phone size in one glance.
* No text, letters, or numerals anywhere in the image.
* The governing metaphor of its domain is the scene's logic, and the visual carries the idea it teaches.
* Nothing invented: no false anatomy, no hybrid creatures, no lying proportions.
* At question time, the asset does not reveal the tested fact.
* If Pip appears: every invariant from section 8.2 holds, the expression uses the approved vocabulary, and the tone law holds.
* If a cameo appears: it is inside its own domain, wears no scarf, no belly dot, and no tufts, and it demonstrates rather than explains.
* The file is webp, reasonably sized for the web, stored under public/cortex in its kind's folder, and entered in the asset manifest with its surface named.
