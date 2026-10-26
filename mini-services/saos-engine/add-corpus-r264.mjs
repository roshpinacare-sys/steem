import * as fs from "node:fs";
const FILE = new URL("./content-corpus.json", import.meta.url).pathname;
const corpus = JSON.parse(fs.readFileSync(FILE, "utf8"));
const ids = new Set(corpus.map((c) => c.id));

const pillars = [
{
  id: "corpus-tools-headcorner",
  voice: "headcorner", topic: "tools",
  tags: ["tools", "life", "workshop", "writing"],
  title: "The Drawer Audit: Counting What the Tools Actually Earned",
  angle: "an honest audit of a drawer full of tools: what got used, what never left the drawer, and the arithmetic of buying for the job you have",
  body: `There is a drawer in most homes that works like a museum of good intentions. Mine held three screwdrivers that do the same job, a laser level that came out once, and a bag of fasteners I cannot identify. The audit started as a joke and turned into one of the more useful hours I have spent, because the drawer was not really holding tools. It was holding guesses.

The method was embarrassingly simple. Every item came out and got one of three marks: used this year, used someday, used never. The counts were humbling. Out of twenty six items, seven had earned their place. Seven. The other nineteen were insurance policies against problems that never arrived, bought at full price and stored at full drawer space.

Here is the arithmetic that changed how I buy. A tool that gets used weekly earns its spot even if it is cheap and ugly. A tool used once a year is a rental, whether you admit it or not: divide the price by the number of uses and the true cost appears. The laser level worked out to more per use than hiring the job done. The cheap utility knife worked out to nearly nothing across hundreds of openings. The price tag tells you what you pay at the register; the use count tells you what you actually paid.

The second pass was harder, because it meant admitting which purchases were fantasy purchases. The fancy multimeter was a fantasy about being someone who troubleshoots circuits. The carving set was a fantasy about weekends that do not exist. Selling or gifting those stung for a day and then, honestly, it felt like putting something down that was heavy.

What stayed tells its own story: a tape measure, two screwdrivers with different tips, a utility knife, pliers, a level that is just a bubble in plastic, and one adjustable wrench. Every fix this year, and there were many, ran through those eight. The jobs did not know the difference. The jobs only needed the right question and one tool that works.

The drawer audit now happens once a season, and the rule for new entries is written on a card taped inside: name the job, name the last time you needed it, or do not bring it home. Tools are not trophies. They are employees, and every employee should be able to point at the work they did this quarter.

Count your own drawer sometime this week. What percentage of it actually worked for a living this year?`,
},
{
  id: "corpus-seasons-israelnews",
  voice: "israelnews", topic: "seasons",
  tags: ["seasons", "life", "nature", "writing"],
  title: "What the First Cold Morning Changes: A Desk Note on Seasons",
  angle: "the newsroom habit of noticing what a season shift quietly rewrites: light, routes, moods, and the small logistics nobody schedules",
  body: `The lede this week was not a headline. It was a jacket. Somewhere between the door and the bus stop, the air changed its terms, and every person on the street was quietly negotiating with the new season: shoulders up, steps faster, coffee held with both hands.

News work trains you to ask what actually changed, and a season change is a whole assignment hiding in plain sight. The light moves. The 7 a.m. street that all summer belonged to squinting joggers now belongs to people lit from behind like figures in a low budget film. The same route feels shorter in October, not because it is, but because there is no pause at the corner to escape the sun.

Then come the quiet logistics nobody schedules. The first cold morning rewrites the day of anyone with a balcony: plants in, rugs out, one panicked hunt for the window sealant. Bicycle commuters renegotiate their whole outfit. The bakery queue doubles in the mornings, as if warmth were sold by the croissant. None of this makes the news, yet every one of these small edits is a story somebody could tell well.

There is a discipline in reading a season like a desk editor reads a wire report. What is new: the light, the temperature, the jacket. What is context: the same streets, the same commutes, the same people. What is the correction from last year: the coat that finally gave up, the umbrella lost in June and needed in October. And what is the open question, the one the day leaves you holding: is this an early winter or a late summer lying to us for a week.

The habit transfers to work of any kind. When something big shifts around you, the reflex is to react to the headline. The better craft is to walk the route and collect the small rewrites: who changed their behavior, which tools came out of storage, what everyone is quietly renegotiating. The season files its story in details, not declarations.

By the second cold morning, the negotiation is over and the new terms feel permanent, the way they always do. Then a warm afternoon arrives and everyone feels briefly cheated, and that too is part of the pattern worth writing down.

What did the first cold morning quietly rewrite on your street, and which small edit did you notice only because it went wrong?`,
},
{
  id: "corpus-language-wic",
  voice: "wic", topic: "language",
  tags: ["language", "writing", "life", "ideas"],
  title: "Words That Refuse to Move: Notes on the Language That Stays Home",
  angle: "the words a language keeps for home: the untranslatable small words, what they hold, and what it means that they never travel",
  body: `Some words never emigrate. Every language keeps a small room of them: words for the exact weight of a silence, for the way light falls at six in the evening, for a kind of tiredness that has no English name. You can carry a dictionary across an ocean and that room stays home.

I have been sitting with one such word for years. It is not beautiful or ancient. It is a small everyday word, the kind used while doing something else, and it refuses to be translated because the thing it points at is built from a hundred tiny habits of a place. Learn the word and you have learned nothing. Live beside it for a season and you understand it without being able to say it.

This is the quiet scandal of translation: the headlines cross, the recipes cross, the poems mostly cross, and the small connective tissue of a life does not. Two people can hold a whole conversation across languages and be perfectly understood, and then one of them uses the small home word and suddenly there is a distance no dictionary crosses.

What interests me is why. It is not that the feeling is unique to one place; feelings are the most portable things we have. It is that the small words are load bearing. They hold up jokes, excuses, greetings, the tiny rituals of a market or a kitchen. A word like that is less like a stone you can carry and more like an arch: move it and it stops being an arch.

So the people who arrive in a new language live twice for a while: once in the language they carry, once in the language around them, and the traffic between the two runs through gestures and guesses. It is exhausting and it is also, quietly, the fastest school of attention there is. You start noticing what people do with their voices, because the words themselves have gone on strike.

In the end the room of untranslated words is not a wall. It is more like a window that shows you where a life is actually lived: in the small words, said while doing something else, to people who already know.

Sit with your own language for a moment: which small word of yours would never survive translation, and what is it really holding up?`,
},
{
  id: "corpus-slow-learning-hcsoldier4",
  voice: "hcsoldier4", topic: "slow-learning",
  tags: ["education", "life", "writing", "habits"],
  title: "Learning in Public: The First Ten Deliberate Hours of a New Skill",
  angle: "a first draft of skill: what ten deliberate, logged hours teach that a hundred casual ones never will, with the honest numbers of a beginner",
  body: `This is a first draft, and it says so on purpose. The idea was to learn something new in public and to log it like a ledger: hour by hour, what was attempted, what failed, what the numbers said. Not the polished version that arrives after the skill is safe, but the version with the eraser marks showing.

The skill itself does not matter much; pick your own. What matters is the difference between ten deliberate hours and a hundred casual ones. Casual hours feel like progress because time passes and the thing gets easier. Deliberate hours are different: each one has a question attached, a small honest test, and a note written at the end. The notes are where the learning actually lives.

Hour one through three were pure humiliation, and the log says so. The hands did not know where to be. Every attempt ended in something that worked by accident, which is the worst kind of working, because you cannot repeat an accident on purpose. The note from hour three: slow down by half, and the error rate dropped by more than half. First real lesson, and it cost almost nothing.

Hours four through six were the plateau that claims most learners. Nothing improved measurably for two full sessions. The old instinct says push harder. The log said something else: the errors had changed shape, from clumsy to subtle, which means the fundamentals had landed and the next gain would come from precision, not effort. That reframe alone was worth the whole exercise.

Hours seven through ten finally produced the first honest results, and the log caught something no feeling would have: the improvements were coming from the boring parts. Position, rhythm, the setup nobody films. Every flashy attempt in the log is followed by a flat line. Every boring attempt is followed by a small climb. Ten hours in, the pattern is already too consistent to ignore.

The deeper result is the log itself. Memory is a flattering editor; it keeps the highlights and deletes the plateaus. The page does not flatter. It shows exactly where the time went and what bought the progress, which turns the next ten hours from a mood into a plan.

Everyone documents finished things. Almost nobody documents the middle. If you picked one skill and kept a one line log for ten deliberate hours, what would your own plateau teach you?`,
},
];
let added = 0;
for (const p of pillars) {
  if (ids.has(p.id)) continue;
  const words = p.body.split(/\s+/).filter(Boolean).length;
  if (words < 300) throw new Error(`pillar too thin: ${p.id} ${words}w`);
  if (p.body.includes("—") || p.body.includes("–")) throw new Error(`dash in ${p.id}`);
  const banned = ["saos", "headcorner", "cashmachine", "haran", "israelnews", "macrame", "hcsoldier", "guaranteed", "in today's world", "in conclusion", "our accounts", "multi-account", "we control"];
  const low = `${p.title}\n${p.body}`.toLowerCase();
  if (banned.some((b) => low.includes(b))) throw new Error(`banned word in ${p.id}`);
  corpus.push({ ...p, words });
  added++;
}
fs.writeFileSync(FILE, JSON.stringify(corpus, null, 2) + "\n");
console.log(JSON.stringify({ added, total: corpus.length, voices: corpus.map((c) => c.voice) }));
