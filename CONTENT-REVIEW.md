# Puzzle review — 28 September 2026

**16 weekly entries enabled, 5 retained but held. 63 chat entries enabled, 4 held.** No Redis rotation was reset by editing these files.

## Ten new weekly puzzles

| ID | Theme | Level | Verification |
| --- | --- | --- | --- |
| w012 | Bridge and shared torch, 1/3/6/8 minutes | Hard | Exhaustive shortest-path solver: 18 minutes |
| w013 | Heavier token among nine | Medium | All nine positions tested, two weighings |
| w014 | 100 toggled lockers | Medium | All 100 passes simulated; ten square numbers |
| w015 | Two irregularly burning ropes | Medium | Burn-time argument under stated assumptions: 45 minutes |
| w016 | Remainders 2/4/6 modulo 3/5/7 | Medium | Exhaustive range search: only 104 |
| w017 | Eight-team round robin | Easy | All unordered pairs counted: 28 |
| w018 | Last digit of 7^2026 | Medium | Exact BigInt arithmetic: 9 |
| w019 | Chessboard with opposite corners removed | Hard | Colour counts 30/32 make domino tiling impossible |
| w020 | Three-digit lock | Hard | All distinct-digit codes searched: only 042 |
| w021 | Two dice sum to nine | Easy | Four favourable outcomes out of 36 |

Checked against existing weekly and chat banks for repeated questions/structures. New wording is in Russian and includes explicit assumptions, canonical answers and explanations. Classic mathematical structures are not claimed as novel inventions. The bridge variation references [Maplesoft's bridge-and-torch activity](https://www.maplesoft.com/support/help/Maple/view.aspx?path=MathApps/TheBridgeAndTorchProblem); the token puzzle references [Cambridge NRICH's 9 Weights](https://nrich.maths.org/problems/9-weights). Other answers are established by the self-contained derivations and executable checks in `test/new-puzzles.test.js`, not by historical anecdotes or an LLM's confidence.

## Existing weekly entries

- w003 and w005 now explicitly use hypothetical/fictional scenarios. Unsupported historical attribution was removed; their answers are possible scenario explanations rather than proofs of real historical events.
- w006 removes an unsupported taste/appearance claim and overstatement about discovery. Its source is [Hopkins' Nobel lecture](https://www.nobelprize.org/prizes/medicine/1929/hopkins/lecture/).
- w008 is a self-contained cash-flow question; unsupported literary attribution removed.
- w009 explains hypothetical heat death without attributing all of thermodynamics to one person or claiming all processes cease. Source: [NASA's cosmology questions](https://imagine.gsfc.nasa.gov/ask_astro/cosmology.html).
- w011 removes unsupported invention/atonement claims and uses the Nobel institution's own [Alfred Nobel history](https://www.nobelprize.org/alfred-nobel/) and [1996 address](https://www.nobelprize.org/ceremonies/1996-opening-address).
- w001, w002, w004, w007 and w010 remain in the file as `enabled: false` with review notes. They need better substantiation or replacement wording before public use.

## Chat bank changes

Corrected c013's truth/lie explanation, c045's sand timing, c055's opponent ambiguity, c061's missing location, c027's twins/triplets wording and c040's chain-joining explanation. Added curated hints and common answer aliases. Held c002 (unverified colour sequence), c004 (inconsistent clock explanation), c028 (unfair legs/paws distinction), and c067 (duplicates the secret-sharing theme).

The remaining bank includes playful lateral riddles with possible alternative answers. The bot accepts canonical/known aliases but does **not** declare unmatched phrasing wrong; users can reveal and compare the stored solution. This is deliberately different from pretending an exact-match checker can reliably judge every freeform explanation.

## Adding more

Give every new entry a new stable ID, question, answer and explanation; add sources for factual claims and a review note for logical checks. Run `npm run check`. Mark questionable entries disabled instead of silently repurposing their IDs. New enabled IDs immediately become candidates after deployment, without deleting posted IDs.
