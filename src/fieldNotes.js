/* Field Notes. Nova notebook as the whole learning product.
 *
 * Written Nov 8, 2026, for Dusty pick of the Field Notes concept
 * from the Nova reset. Every entry here is written once, cached in
 * the bundle, and shared by every reader. Reading an entry never
 * calls the live fleet, so a bad fleet day cannot empty the page.
 * Each entry carries exactly one question, written with the entry.
 * The question gate is the blind check contract from the reset:
 * a second solver answers the question without the entry text,
 * and a question that solver can already answer, or that holds
 * two true options, is rewritten and never shipped as filler.
 * True or false as a form does not exist in this module.
 */

export const FIELD_NOTES_TAGLINE = "Science, one spark at a time.";
export const FLEET_DOWN_LINE = "Nothing new today. The fleet is sulking. Your reviews are ready.";
export const ENTRY_WORD_MIN = 150;
export const ENTRY_WORD_MAX = 250;
export const ENTRY_REVIEW_STEPS_DAYS = [1, 3, 7, 16, 35];

export const FIELD_NOTE_THREADS = [
  {
    id: "sleep_memory",
    title: "Sleep and Memory",
    shelfObject: "A small brass moon",
    shelfGlyph: "moon",
    intro: "What the night shift does with the day you hand it.",
    entries: [
      {
        id: "sleep_files_the_day",
        date: "2026-11-08",
        dateLabel: "Nov 8, 2026",
        title: "The night shift files the day",
        marks: ["sleep", "memory", "learn"],
        noteLine: "From my notebook, Nov 8: deep sleep does the heavy filing, and it works on what the day tagged as worth keeping.",
        body: "I used to think sleep was the brain clocking out. It is closer to a night shift clocking in. While you are out, a small seahorse shaped region called the hippocampus replays the day at high speed, and the cortex listens. Each replay is a chance to move a fragile new memory into longer storage, the way a clerk copies a note from a scrap of paper into the bound ledger before the scrap gets lost. Deep sleep does most of this filing. It favours the things you paid attention to, and the things with feeling attached, which is why the embarrassing moment survives and the grocery list does not. Take Maya, who practised a piano passage at nine in the evening and stumbled through it. She slept, and at breakfast her fingers knew stretches her mind had not caught up with. Nothing mystical happened overnight. Her brain simply had uninterrupted hours to file the work, with no new input elbowing in. The practical part is unglamorous. Learn the thing, then protect the night after it. A short night does not just leave you tired. It leaves the ledger half copied, and the scrap fades by noon.",
        question: {
          kind: "predict",
          prompt: "Jonas studies a new language in the evening, then sleeps badly for two nights running. What should he expect when he sits down to use the words on day three?",
          options: [
            "The words will feel shakier than they did at the end of his study session, because the filing work got cut short.",
            "Sharper than ever, since a tired brain compensates by storing more per hour on less rest.",
            "Perfectly stored within ten minutes, because filing finishes almost as soon as sleep begins.",
          ],
          correct: 0,
          feedback: "Bad nights cut the filing short. The hippocampus replays the day during sleep and the cortex takes the copies, and most of that traffic runs in deep sleep. Two broken nights mean fewer clean replays, so the words stay closer to the scrap of paper stage: present, but easy to lose. Jonas does not need a trick here. He needs one full night, after which the words he already studied get a second chance to settle.",
        },
      },
      {
        id: "sleep_dreams_feelings",
        date: "2026-11-06",
        dateLabel: "Nov 6, 2026",
        title: "Dreams handle the feelings",
        marks: ["dream", "sleep", "emotion"],
        noteLine: "From my notebook, Nov 6: dreaming sleep seems to keep the memory and soften its charge.",
        body: "I keep a separate page for dreams, because they do a different job from the filing I wrote about before. In dreaming sleep, the brain regions that handle emotion run hot while the chemistry of stress runs low. That odd pairing looks like a workshop for feelings. The day gets replayed, but in a room where the alarm bells are unplugged. A memory can be handled, turned over, and put back on the shelf with less of its sting. Think of the argument you had last spring. At the time, remembering it raised your heart rate. Months later you can tell the story at dinner without your hands shaking. Some of that softening is time, sure. Some of it, the evidence suggests, is night after night of dreaming sleep rehearsing the memory in a calm chemical bath. This is also why dreams borrow the faces and places of the day but scramble the plot. The point is not a faithful replay. The point is handling the material. When dreaming sleep is cut short for weeks, people report the same cluster: sharper reactions, longer grudges against the day, a mind that will not set anything down. The filing keeps the facts. The dreaming keeps them bearable.",
        question: {
          kind: "predict",
          prompt: "Priya goes through a bruising week at work and her dreaming sleep keeps getting cut short by early alarms. Weeks later, what is the most likely leftover?",
          options: [
            "She will have forgotten the factual order of events entirely, start to finish.",
            "The memories will stay unusually raw, so small reminders keep hitting harder than they should.",
            "She will feel nothing about the week at all, because missed dreams erase emotional memories.",
          ],
          correct: 1,
          feedback: "The facts usually stay. What dreaming sleep seems to process is the charge on them, rehearsing emotional memories while stress chemistry runs low. Cut that stage short night after night and the memories keep more of their sting, so a stray reminder lands like the event just happened. Erasure is not on offer either way. The work is softening, not deleting.",
        },
      },
      {
        id: "sleep_nap_lengths",
        date: "2026-11-03",
        dateLabel: "Nov 3, 2026",
        title: "A short nap is a tool, not a treat",
        marks: ["sleep", "nap", "memory"],
        noteLine: "From my notebook, Nov 3: a nap borrows part of the night shift, and the length decides what you borrow.",
        body: "I have changed my mind about naps. I had them filed under indulgence, next to second desserts. They belong under tools. A nap is a short loan from the night shift: the brain starts the same filing routine it runs at night, in miniature. The catch is that sleep comes in stages, and waking from the wrong stage has a price. Wake from light sleep after twenty minutes and you surface clear, with a modest filing bonus. Drift down into deep sleep and get dragged out of it at forty minutes, and you surface like a diver pulled up too fast: heavy head, scrambled thoughts, worse than before you lay down. Sleep a full cycle of about ninety minutes and you come up through light sleep again, carrying the filing gains with you. I watched a night nurse work this out the hard way during double shifts. Her twenty minute breaks in the chair left her functional. Her forty minute breaks left her dangerous. Nothing about her discipline changed between those two breaks. Only the stage she surfaced from changed. So the rule I write in the margin is plain. Keep it short, or commit to the full cycle. The middle is the trap.",
        question: {
          kind: "predict",
          prompt: "Tomas has a long drive at dusk and can nap first. He wants to wake clear headed, and he only has half an hour in total. What does the nap science in my notes point him to?",
          options: [
            "Nap for about twenty minutes and wake from light sleep, rather than using every minute he has.",
            "Nap for the whole half hour past the deep point, because more minutes always means more rest.",
            "Skip the nap and drink strong coffee in the car, because naps under an hour do nothing at all.",
          ],
          correct: 0,
          feedback: "Twenty minutes keeps him in light sleep, which he can surface from cleanly. The trap is the middle ground: dropping into deep sleep and being pulled out of it leaves a heavy, scrambled head for a while after waking. A full sleep cycle of about ninety minutes would also work, but Tomas does not have ninety minutes. Short on purpose beats longer by accident.",
        },
      },
    ],
  },
  {
    id: "bees_home",
    title: "How Bees Find Home",
    shelfObject: "A glass honeycomb",
    shelfGlyph: "comb",
    intro: "Navigation without a map, run on sunlight and memory.",
    entries: [
      {
        id: "bees_no_map",
        date: "2026-11-07",
        dateLabel: "Nov 7, 2026",
        title: "They do not carry a map",
        marks: ["bee", "bees", "navigation", "insect"],
        noteLine: "From my notebook, Nov 7: bees do not carry a map. They compare the world against photographs they took on the way out.",
        body: "I did not expect photographs. A bee leaving a new hive for the first few times does something that looks like pure fussiness: she flies out a short way, turns, and hovers facing home, then does it again farther out. She is not lost. She is taking pictures. Her brain stores snapshots of what the world looks like from the hive, at several distances, and on the way back she flies so that the view in front of her matches a stored snapshot more and more closely. No map. No grand plan of the whole meadow. Just a stack of remembered views and a rule: shrink the difference. It is a humble system and it is brutally effective, right up until somebody moves the landmarks. Shift a row of coloured boards near the hive while the bees are out and returning bees will search where the snapshots say home should be, hovering at empty air a board width to the left. I find that failure more instructive than the success. It tells you exactly what the system holds. Not the place itself. A picture of the place, taken on departure, trusted completely. We do something similar in a new city, if we are honest. We just have better stories about it.",
        question: {
          kind: "predict",
          prompt: "A keeper paints the hive front a new colour and moves it two metres sideways while the foragers are out. When they return, where will many bees search first?",
          options: [
            "At the old spot, in the direction their stored views point them, even though the hive sits in plain sight nearby.",
            "Straight into the moved hive, because smell alone overrules everything they stored on the way out.",
            "They will circle the whole field in a grid until one finds the entrance by pure chance.",
          ],
          correct: 0,
          feedback: "The stored views win the first round. A returning bee steers by matching what she sees against the snapshots she took leaving, and those snapshots describe the old position and the old colour. So she searches the place the pictures describe, hovering over empty ground, before slower cues sort her out. That stubbornness is the tell: navigation here runs on remembered views, not on a live map of where things are now.",
        },
      },
      {
        id: "bees_sun_compass",
        date: "2026-11-05",
        dateLabel: "Nov 5, 2026",
        title: "The sun is a compass that moves",
        marks: ["bee", "bees", "sun", "navigation"],
        noteLine: "From my notebook, Nov 5: a bee reads the sun like a clock hand, and corrects for the hours it has moved.",
        body: "I have a soft spot for any animal that does astronomy before breakfast. A bee navigates by the sun, which is a fine compass with one obvious flaw: it will not sit still. The sun crawls across the sky all day, so a direction read from it at dawn is wrong by noon. Bees handle this the way a good navigator would. They carry an internal clock, and they correct the sun position by the time of day, as if consulting a timetable they were born knowing. The elegant proof came from keeping bees under an artificial sun that stayed fixed. Their dances and their flights drifted off course by exactly the hours their clocks said had passed. They were correcting for a movement that was not happening. Under a real sky the same correction keeps a food source bearing true from morning to evening, even when clouds hide the sun itself, because polarised light patterns in blue sky carry the same information. I write this down because it reframes what an insect brain is. Not a bundle of reflexes. A small observatory with wings, running a model of the sky and updating it by the hour.",
        question: {
          kind: "predict",
          prompt: "Researchers keep bees under a lamp rigged to look like a sun that never moves. Hours pass. What happens to the direction the bees treat as the way to food?",
          options: [
            "Nothing changes, because a compass reading needs no correction once it is taken.",
            "Their bearing drifts by the amount their internal clock expects the real sun to have moved.",
            "They abandon the lamp at once and refuse to fly until a moving sun is restored.",
          ],
          correct: 1,
          feedback: "The drift is the whole story. Bees correct a sun bearing by the time on their internal clock, so under a lamp that stays put they keep applying a correction for motion that never happened, and the bearing walks away from the truth hour by hour. Far from being a failure, that error is the evidence: it shows the correction exists, and that it runs whether or not the sky cooperates.",
        },
      },
      {
        id: "bees_smell_doorbell",
        date: "2026-11-02",
        dateLabel: "Nov 2, 2026",
        title: "Smell is the last doorbell",
        marks: ["bee", "bees", "smell", "hive"],
        noteLine: "From my notebook, Nov 2: the last check at the hive door is smell, and strangers fail it.",
        body: "I like a system with a doorman. A bee can navigate a kilometre of countryside by sun and snapshot, but the last centimetre of the journey home is decided by smell. Every colony carries its own scent signature, built from the wax, the queen, and the shared traffic of thousands of bodies. Guard bees at the entrance sample incoming bees the way bouncers check faces, and a bee wearing the wrong colony scent gets bitten, balled, and thrown out, however good her navigation was. It sounds harsh until you price the alternative. A strange bee at the door in autumn is usually a robber, there for the honey, and honey is winter survival. Strangers are not a paperwork problem. They are an existential one. The piece of this I keep turning over is the layering. Long range, the bee trusts astronomy. Middle range, she trusts photographs. At the threshold, she trusts chemistry, the one sense a robber cannot easily fake. Each layer covers the weakness of the one before it. When I design anything meant to survive contact with the real world, I think about that door. Elegant guidance gets you home. A doorman decides whether you get in.",
        question: {
          kind: "predict",
          prompt: "A lost bee from another colony navigates perfectly and lands at the entrance of a hive that is not hers, wearing her own colony scent. What should she expect?",
          options: [
            "A warm welcome, because arriving accurately proves she belongs to the colony.",
            "The guards will likely attack and eject her, because at the door the scent check decides.",
            "She will be ignored completely, because guard bees only watch for bees arriving by smell alone.",
          ],
          correct: 1,
          feedback: "Navigation gets her to the door. It does not get her through it. Colony scent is the credential the guards check, and hers is wrong, so she reads as what she most likely is in their accounting: a robber after the stores. Perfect flying, failed doorbell. The layers of the system each guard a different risk, and the last layer answers to chemistry, not to skill.",
        },
      },
    ],
  },
  {
    id: "gut_guards",
    title: "The Gut and the Guards",
    shelfObject: "A green glass leaf",
    shelfGlyph: "leaf",
    intro: "Why so much of the immune system lives at one busy border.",
    entries: [
      {
        id: "gut_crowded_border",
        date: "2026-11-04",
        dateLabel: "Nov 4, 2026",
        title: "A crowded border",
        marks: ["gut", "immune", "food"],
        noteLine: "From my notebook, Nov 4: the gut is a border that must let dinner through and keep invaders out, often in the same hour.",
        body: "I keep coming back to the strangeness of the arrangement. The largest share of your immune tissue does not sit in some fortress deep inside you. It lines your gut, a border you deliberately open three times a day to let the outside world in, ground up, as lunch. Every other border in biology is simpler. Skin keeps things out, full stop. The gut has to run a customs hall: absorb the food, tolerate the trillions of resident microbes that help you digest it, and still catch the rare genuine invader hiding in the same stream. Tolerance and defence, at the same gate, on the same shift. The failures teach the design. When tolerance slips, the system attacks residents and food as if they were invaders, and the border itself becomes the battlefield. When defence slips, things that should have been stopped at the gate get a free pass inward. A useful picture is an airport that must wave through regulars by the thousand, feed them, seat them, and still spot the one forged passport in the crowd. Exhausting, error prone, and absolutely necessary. You cannot eat through a wall. So evolution built a border with judgment instead, and staffed it heavily.",
        question: {
          kind: "predict",
          prompt: "A treatment calms the gut immune system so strongly that its defence work is muted along with its overreactions. What risk rises first at that border?",
          options: [
            "Genuine invaders that would normally be stopped at the gate start getting through more often.",
            "Food stops being absorbed entirely, because absorption is done by the immune cells themselves.",
            "The resident microbes vanish within a day, because they depend on being attacked to survive.",
          ],
          correct: 0,
          feedback: "Defence is half the job at that gate, and muting it has a price. The gut immune system spends its days sorting residents and food from genuine invaders in the same stream. Quiet the whole operation and the sorting may calm down, but the forged passports start slipping through. That tradeoff is why calming this border is a balancing act rather than a simple matter of turning the volume down.",
        },
      },
      {
        id: "gut_feeding_guards",
        date: "2026-11-01",
        dateLabel: "Nov 1, 2026",
        title: "Feeding the border guards",
        marks: ["gut", "fiber", "fibre", "immune", "food"],
        noteLine: "From my notebook, Nov 1: the microbes turn fibre into messages, and the border guards listen.",
        body: "I wrote in the last entry that the gut is a staffed border. This entry is about the catering. The microbes in your colon eat what you cannot: the fibre in beans, oats, skins, and stalks. In return they produce small molecules with long names and a simple job. These molecules feed the cells lining the gut wall and talk to the immune guards stationed there, mostly in a calming dialect: the barrier is fine, the residents are known, stand down. A colon starved of fibre produces fewer of those molecules. The wall lining gets hungrier, the mucus layer thins, and the guards get jumpier, closer to treating residents as intruders. I find the chain satisfyingly unglamorous. No rare supplement, no imported powder. The message molecules that keep a border calm are brewed on site, from the roughage most dinners throw away. The catch is that the brewery needs its workforce. A gut whose microbial mix has narrowed, after illness or a long beige diet, ferments less from the same plate of food. Feeding the guards is really two jobs. Keep the brewers, and keep sending them raw material worth brewing. The point is plain enough: fibre in, calm out.",
        question: {
          kind: "predict",
          prompt: "Ana switches to a low fibre diet for two months while eating the same calories. What does my note on the border predict for her gut wall?",
          options: [
            "Its mucus layer thickens and its guards calm down, because less fibre means less work.",
            "Little changes, because the wall feeds itself from the bloodstream and ignores the gut contents.",
            "The wall gets less of the calming molecules its microbes brew from fibre, so the barrier runs thinner and jumpier.",
          ],
          correct: 2,
          feedback: "The wall eats from the stream it guards. Gut microbes ferment fibre into small molecules that feed the gut lining and tell the local immune guards to stay calm. Cut the fibre and the brewing slows, the mucus thins, and the border gets more reactive, even at the same calorie count. It is not the amount of food that changed for Ana. It is the raw material her microbes had to work with.",
        },
      },
    ],
  },
  {
    id: "how_science_works",
    title: "How Science Works",
    shelfObject: "A brass prism",
    shelfGlyph: "prism",
    intro: "The method, without the ceremony.",
    entries: [
      {
        id: "science_answerable_question",
        date: "2026-10-30",
        dateLabel: "Oct 30, 2026",
        title: "A question the world can answer",
        marks: ["science", "evidence", "question"],
        noteLine: "From my notebook, Oct 30: a scientific question is one the world can answer back, in a way that could embarrass you.",
        body: "I ask one thing of a question before I honour it with effort: can the world answer it back? Not agree with it. Answer it. A testable question has a shape where some possible result would count against you, in public, on the record. Does this seed sprout faster in light or in dark? Plant both, count both, and one of your hopes loses. Compare that with the questions that feel scientific but are built to survive anything. Is this herb restoring my natural balance? Every outcome fits. Feeling better proves it works, feeling worse proves it is drawing the badness out. A question that cannot lose cannot teach. I keep a private list of my own questions that failed this test over the years, and it is not short. Each one felt deep at the time. Each one was, on inspection, a mirror: I was asking the world to show me my own face and calling the reflection data. The habit I trust now is embarrassingly small. Before running anything, write down the result that would change your mind. If your hand will not move, the question is not ready, and neither are you. The world is generous with answers. It charges one price: the possibility of being wrong.",
        question: {
          kind: "predict",
          prompt: "Leo claims his new study method works because every student he asks says they feel sharper after using it, and he counts tired students as proof their brains are rebuilding. Why does my notebook call his question unready?",
          options: [
            "He asked too few students, and fifty testimonials would settle the matter completely.",
            "No result could count against him, since both feeling sharp and feeling tired get counted as success.",
            "Feelings are never part of science, even as a measured outcome with a comparison group.",
          ],
          correct: 1,
          feedback: "Both outcomes pay out for Leo, and a question that cannot lose cannot teach. Feeling sharper counts as proof, and feeling tired also counts as proof, so the world has no move that answers him back. The fix is not a pile of testimonials. It is deciding in advance which result would change his mind, then running the comparison that could produce it.",
        },
      },
      {
        id: "science_one_result_rumor",
        date: "2026-10-28",
        dateLabel: "Oct 28, 2026",
        title: "One result is a rumor",
        marks: ["science", "evidence", "replication", "study"],
        noteLine: "From my notebook, Oct 28: one result is a rumor until strangers can make it happen again.",
        body: "I have learned to hold a single study the way I hold gossip from a charming stranger: interested, entertained, and not yet willing to repeat it as fact. One result, however clean, arrives wrapped in everything about that one lab: their hands, their habits, their batch of materials, their weather. Any of it could be the real author of the finding. Replication is the rude and necessary second act, where people with no stake in your glory try to make the thing happen in their own rooms, with their own hands. When it happens again, and again, the finding slowly changes address: it stops belonging to a lab and starts belonging to the world. When it refuses to happen again, that is information too, though it arrives dressed as disappointment. I do not think this makes science slow. I think it makes science load bearing. The findings you can build a bridge on are precisely the ones that survived being doubted by strangers. So my margin rule is simple. A first study earns a bookmark, not a belief. Two independent reruns earn attention. A finding that survives enemies earns trust. Everything else is a rumor with a chart attached, and charts, I have noticed, are very easy to dress up.",
        question: {
          kind: "predict",
          prompt: "A single lab reports that a cheap powder doubles plant growth, and the chart looks beautiful. A grower asks whether to rebuild her whole greenhouse routine around it. What does this notebook counsel?",
          options: [
            "Rebuild at once, because a published chart from a real lab settles a claim.",
            "Refuse the powder forever, because single studies are always fabricated.",
            "Treat it as a promising rumor: trial it small, and wait for other hands to make the result happen again before rebuilding around it.",
          ],
          correct: 2,
          feedback: "A first study earns a bookmark, not a belief. The result may be real, but it may also belong to that one lab: their materials, their habits, their conditions. A small trial risks little and teaches a lot, and independent reruns are what move a finding from rumor toward fact. Rebuilding the whole routine on one chart is paying full price for evidence that has not finished arriving.",
        },
      },
    ],
  },
];

export function fieldNoteEntries(threads = FIELD_NOTE_THREADS) {
  const out = [];
  for (const t of threads) for (const e of t.entries) out.push({ ...e, threadId: t.id, threadTitle: t.title });
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/* The Today word on the newest entry is earned by the date, never by
   position. Before 2026-11-12 the view printed it for whichever entry
   sat first, so the Nov 8 entry still called itself Today on Nov 9 and
   would have kept doing so forever. The day argument is injectable so
   the suite can pin both cases without waiting for the calendar. */
export function entryIsToday(entry, d = new Date()) {
  if (!entry || !entry.date || !(d instanceof Date) || Number.isNaN(d.getTime())) return false;
  const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  return entry.date === key;
}

export function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

const DASH_CHARS = /[-–—]/;

export function entryProblem(entry) {
  const problems = [];
  if (!entry || typeof entry !== "object") return ["entry missing"];
  if (!/^\d{4}\-\d{2}\-\d{2}$/.test(entry.date || "")) problems.push("entry is not dated in ISO form");
  if (!entry.dateLabel) problems.push("entry has no readable date");
  const words = wordCount(entry.body);
  if (words < ENTRY_WORD_MIN || words > ENTRY_WORD_MAX) problems.push("entry body is " + words + " words, outside the " + ENTRY_WORD_MIN + " to " + ENTRY_WORD_MAX + " band");
  if (!/\bI\b/.test(entry.body || "")) problems.push("entry is not written in first person");
  if (DASH_CHARS.test([entry.title, entry.body, entry.noteLine].join(" "))) problems.push("entry carries a dash character in visible text");
  const q = entry.question;
  if (!q) { problems.push("entry has no question"); return problems; }
  if (q.kind === "truefalse" || q.kind === "true_false") problems.push("true or false form is banned");
  if (!["predict", "explain"].includes(q.kind)) problems.push("question kind is not a preferred shape");
  if (q.kind === "predict") {
    if (!Array.isArray(q.options) || q.options.length < 3) problems.push("prediction question needs at least three options");
    if (typeof q.correct !== "number" || !q.options || q.correct < 0 || q.correct >= q.options.length) problems.push("prediction question has no valid correct option");
    const firstWords = (q.options || []).map((o) => String(o).trim().split(/\s+/)[0].toLowerCase());
    if (new Set(firstWords).size === 1 && firstWords.length > 1) problems.push("options all open with the same word");
    if (DASH_CHARS.test([q.prompt, ...(q.options || [])].join(" "))) problems.push("question carries a dash character in visible text");
  }
  if (!q.feedback || wordCount(q.feedback) < 25) problems.push("feedback is too thin to teach");
  if (q.feedback && entry.body && entry.body.includes(q.feedback)) problems.push("feedback repeats the entry instead of teaching");
  return problems;
}

export function validateFieldNotes(threads = FIELD_NOTE_THREADS) {
  const problems = [];
  const entries = fieldNoteEntries(threads);
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.id)) problems.push("duplicate entry id " + e.id);
    seen.add(e.id);
    for (const p of entryProblem(e)) problems.push(e.id + ": " + p);
  }
  for (const t of threads) if (!t.entries || t.entries.length === 0) problems.push("thread " + t.id + " holds no entries");
  return { ok: problems.length === 0, problems, entryCount: entries.length, threadCount: threads.length };
}

/* The blind check contract. The solver only ever receives the
 * prompt and the options, never the entry body. It returns the
 * option it picks and any other options it judges also true. */
export async function blindCheckQuestion(question, solver) {
  if (!question || typeof solver !== "function") return { ok: false, reasons: ["no blind solver supplied"] };
  const verdict = await solver({ prompt: question.prompt, options: [...(question.options || [])] });
  const reasons = [];
  if (!verdict || typeof verdict.pick !== "number") reasons.push("blind solver returned no pick");
  else {
    if (verdict.pick === question.correct) reasons.push("blind solver already knew the answer without the entry");
    if (Array.isArray(verdict.alsoTrue) && verdict.alsoTrue.filter((i) => i !== question.correct).length > 0) reasons.push("blind solver found a second true option");
  }
  return { ok: reasons.length === 0, reasons };
}

export async function blindCheckEntries(entries, solver) {
  const results = [];
  for (const e of entries) results.push({ id: e.id, ...(await blindCheckQuestion(e.question, solver)) });
  return results;
}

/* Entry review scheduling. This is the old spaced review idea
 * repointed from claims to entries: a read entry comes back on a
 * widening ladder, and a missed review answer restarts the ladder. */
export function scheduleEntryReview(state, entryId, correct, now = Date.now()) {
  const prev = (state && state[entryId]) || { step: 0, dueAt: 0, attempts: 0 };
  const step = correct ? Math.min(prev.step + 1, ENTRY_REVIEW_STEPS_DAYS.length - 1) : 0;
  const days = ENTRY_REVIEW_STEPS_DAYS[correct ? step : 0];
  return { ...(state || {}), [entryId]: { step, dueAt: now + days * 86400000, attempts: prev.attempts + 1, lastCorrect: !!correct } };
}

export function dueEntryReviews(state, entries, now = Date.now()) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const due = [];
  for (const [id, rec] of Object.entries(state || {})) {
    if (rec && rec.dueAt && rec.dueAt <= now && byId.has(id)) due.push({ entry: byId.get(id), record: rec });
  }
  return due.sort((a, b) => a.record.dueAt - b.record.dueAt);
}

/* Bad fleet day behaviour. Cached entries and due reviews are the
 * product that day; new entries pause behind one honest line. */
export function notebookForFleet({ fleetUp = true, entries = fieldNoteEntries(), reviewState = {}, now = Date.now() } = {}) {
  const due = dueEntryReviews(reviewState, entries, now);
  if (fleetUp) return { entries, reviews: due, paused: false, notice: null };
  return { entries, reviews: due, paused: true, notice: FLEET_DOWN_LINE };
}

export function notebookLineFor(text, entries = fieldNoteEntries()) {
  const hay = String(text || "").toLowerCase();
  if (!hay) return null;
  for (const e of entries) if ((e.marks || []).some((m) => hay.includes(m))) return { entryId: e.id, line: e.noteLine };
  return null;
}

export function paperHasNote(paper, entries = fieldNoteEntries()) {
  const hay = [paper && paper.title, paper && paper.abstract, paper && paper.journal].filter(Boolean).join(" ").toLowerCase();
  if (!hay) return null;
  for (const e of entries) if ((e.marks || []).some((m) => hay.includes(m))) return e;
  return null;
}

export function threadProgress(thread, readIds) {
  const read = new Set(readIds || []);
  const done = thread.entries.filter((e) => read.has(e.id)).length;
  return { done, total: thread.entries.length, complete: done === thread.entries.length };
}
