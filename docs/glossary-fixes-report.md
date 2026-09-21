# Glossary fixes: report

Applied to `data/glossary.txt` from the human review. Entries were found by their `forms` text, each edit asserted the
line it expected to find before changing it, and every verse the review marked to verify was checked against the KJV
text in `bible.db`. The file now has 591 entries.

## What the parser and matcher actually do (the review asked)

- **1.1 Whitespace.** `parseGlossary` trims every `|`-separated field (`raw.split("|").map((s) => s.trim())`), so the
  leading space did **not** stop those entries from matching. `wist`, `prevent`, `thy seed` and `vex` all matched
  before the change; stripping them was tidiness only. The review counted 34 such lines; there were **31**.
- **1.2 `@!`.** The parser implements it (`except = scope.startsWith("@!")`, and `applies()` inverts the test), and it is
  already relied on by the `thy seed` entry. Nothing to implement; the header now documents it.
- **5. `sore ...` phrases.** The matcher tries phrases before single words at every position, and longer phrases
  before shorter ones, so `sore vexed`, `sore confounded` and `sore athirst` did hide the separate glosses for
  `vexed`, `confounded` and `athirst`. Per the review, those three forms were **removed** from the `sore afraid...` line.

## Applied

**1. Format**
- 1.1: stripped leading and trailing whitespace on 31 entry lines. Comments and blank lines are untouched.
- 1.2: added the `@!` line to the header, after the `verses` comment.
- 1.3: merged `cockatrice` and `cockatrices` into `cockatrice, cockatrices | archaic | a venomous snake, probably a viper`, and deleted the separate `cockatrices` line.
- 1.4: `paneled` -> `panelled` (`cieled`), `hemorrhoids` -> `haemorrhoids` (`emerods`).

**2. Kinds**
- 2.1: `archaic` -> `changed` for `tired`, `strange woman, strange women`, `strange wives`, `strange gods, strange god`, and the `i pray thee...` entry.
- 2.2: `strange fire`, `strange land`, `strange children` now `changed`, each with its Today field.
- 2.3: 16 modern words `archaic` -> `changed` with a Today field: `target, targets`, `founder`, `amber` (also dropped ", not the yellow resin" from its meaning), `league`, `parlour`, `pastors`, `vintage`, `ensue`, `supplant, supplanted`, `certify`, `outlandish`, `overcharge, overcharged`, `hale`, `rent`, `seethe, seething`, `sodden`.
- 2.4: `from without` is now `archaic` with the "Today: from lacking" field removed.

**3. Glosses**
- Replaced the whole line for `bolster`, `tattlers`, `take no thought...`, `testament`, `occupy...`, `cunning, cunningly`, `curious, curiously`, `communicate`, `communication, communications`, `spoil...`.
  The verse references written into these glosses were checked and all hold: Judges 16:11 and Exodus 38:24 ("occupied"), Ephesians 4:14 ("cunning craftiness"), Acts 19:19 ("curious arts"), Galatians 2:2 ("communicated"), Philemon 1:6 ("communication"), Song of Solomon 2:15 ("spoil the vines"), Hebrews 9:16-17 ("testament").
- 3.1: `sunder` -> `in sunder`. **Verified:** "sunder" occurs 7 times in the KJV (Psalms 46:9, 107:14, 107:16; Isaiah 27:9, 45:2; Nahum 1:13; Luke 12:46), always as "in sunder".

**4. Verses**
- 4.1: `lighted` restricted to Genesis 24:64; Joshua 15:18; Judges 1:14; Judges 4:15; 1 Samuel 25:23; 2 Kings 5:21; Isaiah 9:8. **All seven verified**, each containing "lighted" in the got-down / fell-upon sense. Meaning extended with "(of a word) fell upon".
- 4.2: `lewd` restricted to Acts 17:5 (verified: "certain lewd fellows of the baser sort").
- 4.3: `whole`: removed Jeremiah 19:11 (a broken vessel, meaning intact); added Matthew 14:36, Luke 7:10, John 7:23, Acts 4:10, **all verified** ("perfectly whole", "found the servant whole", "every whit whole", "standeth here before you whole").
- 4.4: `let` -> `let, letteth` (2 Thessalonians 2:7 reads "he who now letteth will let", verified). `press` (winepress) -> `press, presses` with Proverbs 3:10 and Isaiah 16:10 added (both read "presses", verified). `mark` (notice) -> `mark, marked` with Luke 14:7 added ("when he marked how they chose out the chief rooms", verified). **Checked** the 15 existing verses on the `mark` line: every one uses "mark", none uses "marked", so the new form cannot match in a different sense there.
- 4.5: added to `knew, known, know` Genesis 19:5 and Judges 19:22; to `clean` Joel 1:7 ("made it clean bare"); to `without` Luke 1:10, John 20:11, Exodus 26:35, Exodus 27:21, Exodus 40:22, Leviticus 24:3; to the `thy seed` exclusion list Job 39:12 and 1 Samuel 8:15. **All verified.**
- 4.7: every list edited was already in book order; each stays sorted.

## Skipped or left alone

- **Nothing was skipped for want of verification.** Every verse marked VERIFY was found and contained the word in the stated sense.
- **4.6: Acts 24:19 was not added to `ought`**, as instructed. Known limitation: the verse uses "ought" in both senses ("who ought to have been here... if they had ought against me"), and matching by verse cannot tell them apart.

## Found while checking (not applied, for a human decision)

- **`lighted`: two more archaic uses the review did not list.** Genesis 28:11 ("he lighted upon a certain place") and 2 Kings 10:15 ("he lighted on Jehonadab"), meaning came upon or met. They are not "got down" or "fell upon" exactly, so a fitting gloss would need adding, for example "came upon; met by chance". The other four unlisted uses (Exodus 40:25, Numbers 8:3, Luke 8:16, Luke 11:33) are the modern "kindled" and correctly stay unmatched.

## Needs human decision (not applied)

- `gay` is `changed` but has no Today field (the validation script allows it).
- `infidel` and `novice` may not be real false friends, because the modern meaning is close to the KJV one. Keep, reword or remove.
- The unit entries mix conventions: some give metric and imperial figures, others metric only.
- Proposed new entries. **Their verses were checked** and all exist and contain the form:
  - `host | changed | an army | Today: someone who receives guests | @! Luke 10:35; Romans 16:23`. Luke 10:35 ("gave them to the host") and Romans 16:23 ("Gaius mine host") are the modern sense; the word occurs in 179 verses in all, so the exclusion list is the right shape.
  - `wept sore, waxed sore`. "wept sore" occurs in 5 verses and "waxed sore" in 1 (Genesis 41:56). No verse list is needed.
  - `shambles` (1 Corinthians 10:25), `chapmen` (2 Chronicles 9:14), `neesings` (Job 41:18): each occurs once.
  - `stay | ... | @ 2 Samuel 22:19; Psalms 18:18; Isaiah 3:1`: all three read "stay" as a support. The word occurs in 30 verses, so scoping is needed.
  - `ear, eared | ... | @ Deuteronomy 21:4; 1 Samuel 8:12; Isaiah 30:24`: "neither eared nor sown", "to ear his ground", "oxen... that ear the ground".
  - `fray | ... | @ Deuteronomy 28:26; Jeremiah 7:33; Zechariah 1:21`: all three read "fray" as frighten.

## Validation

Before the edits (the review's script, unmodified):

```
52 leading/trailing whitespace
89 leading/trailing whitespace
104 leading/trailing whitespace
125 leading/trailing whitespace
325 leading/trailing whitespace
326 leading/trailing whitespace
348 leading/trailing whitespace
349 leading/trailing whitespace
355 leading/trailing whitespace
400 leading/trailing whitespace
423 leading/trailing whitespace
432 leading/trailing whitespace
434 leading/trailing whitespace
443 leading/trailing whitespace
451 leading/trailing whitespace
486 archaic entry has Today
496 leading/trailing whitespace
498 archaic entry has Today
499 leading/trailing whitespace
499 archaic entry has Today
500 archaic entry has Today
507 leading/trailing whitespace
512 leading/trailing whitespace
521 leading/trailing whitespace
522 leading/trailing whitespace
553 leading/trailing whitespace
558 leading/trailing whitespace
562 leading/trailing whitespace
578 leading/trailing whitespace
581 leading/trailing whitespace
586 archaic entry has Today
589 leading/trailing whitespace
613 leading/trailing whitespace
615 leading/trailing whitespace
621 leading/trailing whitespace
623 leading/trailing whitespace
validation done
```

After the edits:

```
validation done
```

The project's own tests (`npm test`, which check every form and scoped verse against the real Bible) also pass: 113 of 113.
