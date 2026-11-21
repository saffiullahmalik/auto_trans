# SundarSTEM Translation Assistant

A Chrome extension that helps teachers translate their assigned SundarSTEM math questions into **Urdu** (and **Sindhi**) and send them for review.

1. The teacher logs in with their own portal translator account.
2. They choose their name. The extension lists the units (chapters) assigned to them in the coordinator's sheet and loads every question in those units that still needs translation.
3. For each question the extension shows the English on the left and an editable Urdu draft on the right. The draft comes from AI, or from the teacher's own earlier translations.
4. The teacher corrects it and presses **Ctrl+Enter**. The extension attaches the step images and sends the question for review on the portal, then opens the next question.

## Install (for teachers)

1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Open `chrome://extensions` in Chrome or Edge and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin the extension and click its icon. The assistant opens in a new tab.

## Using it

- **Log in** with your portal email and password. The portal allows one login per account at a time, so logging in here signs you out of the portal in other tabs (and vice versa). If that happens mid-work, the extension asks for your password again and keeps your drafts.
- **Assigned units** (the default tab):
  - Choose your name. It is picked automatically if your portal account name matches the sheet, and remembered after that.
  - Your units appear with their question counts, e.g. *Class 3 · Shapes — 25 questions*. Untick any you don't want to load now, then press **Load questions**.
  - The extension loads every question in those units whose translation is pending or was rejected. It reports how many it found per unit and flags any count that differs from the sheet.
  - **Add another unit** lets you load a unit that isn't in the sheet: pick the Class and Subject, then type the unit name.
- **Question IDs** (second tab): paste a whole column of IDs from Excel or Google Sheets, header included. Blank cells, duplicates and text such as "Question ID" are handled automatically.
- **The question list** shows each question's portal status:
  - IDs that don't exist are marked **Not available**.
  - Questions already sent or approved are marked **Already sent**.
  - Rejected questions can be worked on again, and the reviewer's comment is shown.
- **The editor:**
  - **Question** and each **Solution step** has its own Urdu box, plus a live preview with the math rendered.
  - Formulas are written as `$...$`, exactly as on the portal. If a formula in your translation differs from the English, the box shows a warning, and you're asked to confirm before sending.
  - **Images** in an English solution step are downloaded and attached to the matching Urdu step. Untick an image to leave it out.
  - Drafts autosave. You can close the tab and come back with **Resume previous list**.
- **Keys and buttons:**
  - **Ctrl+Enter** sends the question for review and moves to the next one.
  - **Skip** leaves a question for later.
  - **Regenerate AI** asks for a fresh suggestion.
- **Download results (CSV)** gives a per-ID report to share with the coordinator.

After each send, the extension re-reads the question from the portal and marks it **Sent for review** once the portal confirms `pending_review`.

### Translation memory

Every sentence a teacher sends is remembered on that computer. When the same English sentence comes up again, even with different numbers (`order $5$` vs `order $2$`), the saved translation is filled in instantly, with no AI call. You can clear it in **Settings**.

## Reviewer mode

When a **reviewer** account logs in, the extension opens the reviewer screens instead of the translator ones. The same extension serves both roles.

### Dashboard
- **Totals for the chosen language:** questions in total, translated, waiting for review, approved, sent back, and left to translate.
- **Load progress:** one row per assigned unit, covering every teacher in the current assignments. Each row shows questions, left to translate, waiting review, approved and sent back, a progress bar, and who translated them, with a subtotal per teacher and a grand total.

### Review translations
1. **Load review queue**, then group it **by translator** or **by unit**. Each group shows how many translations have problems.
2. Pick a group to open its translations one at a time, side by side: English on the left, Urdu on the right, with math and the images from both sides.
3. **Automatic checks** appear above the Urdu:
   - **Errors:** numbers from the English missing in the Urdu, step images missing, empty or missing steps.
   - **Warnings:** numbers not in the English, numbers not formatted as math (`$…$`), bold or list formatting lost, English words left untranslated. An English term in brackets, like "(Rotational Symmetry)", is fine.
4. **Keys:**
   - **Ctrl+Enter** approves the translation and opens the next one.
   - **Ctrl+Shift+Enter** sends it back. Pick quick reasons ("Formula missing or changed", "Image missing", …), add a note, and press Ctrl+Enter. The translator sees the reason on their screen.
   - **Skip** and **Previous** move through the list.

English text can't be edited here, because the portal's reviewer screens don't offer it.

### Teacher assignments
- Starts from the current assignment list. Add or remove teachers and units.
- **Find units that still need translation:** lists every unit in every book with questions still to translate. Hide the ones already assigned, filter by book, and click **Assign** next to a teacher.
- **Save assignments** keeps the list in your extension; the dashboard progress uses it.
- **Download Excel / Download CSV** produces a sheet in the same layout as the coordinator's sheet.
- **Teachers load a new sheet** with **Import sheet** on their "Assigned units" tab. It replaces the list built into the extension.

### Portal calls used
| Step | Call |
| --- | --- |
| Review queue | `GET /api/question-review/pending?translation_status[]=pending_urdu_review&per_page=100&page=N` (the translator's name comes with each item) |
| Unit progress | the same list with `unit[]=<unit>` and the four Urdu statuses, filtered by class and subject in the extension |
| Totals | `GET /api/admin/questions/statistics` |
| Approve / send back | `POST /api/question-translations/{translationId}/review` with `{"status":"approved"}` or `{"status":"rejected","rejection_comment":"…"}` |

## Updating teacher assignments (admin)

Assignments ship inside the extension as `extension/assignments.json`. When the sheet changes:

```bash
npm run assignments -- "Urdu_Translation_Teacher_Assignments.xlsx"
```

Then share the updated `extension` folder; teachers click the reload icon on `chrome://extensions`.

- **Sheet format:** a header row with **Teacher Name, Subject, Class, Unit Name, Unit Questions**, one row per teacher-unit pair, like the current sheet.
- **Unit names:** they are matched loosely to the portal's spelling, so `Fractions ×, ÷` finds the portal's `Fractions ×  , ÷`, and `Fractions +, −` finds `Fractions +, _`.
- **Class and subject:** a unit name such as *Shapes* or *Division* exists in more than one class. The extension keeps only the questions of the assigned Class and Subject.
- **Checked against the portal:** all 24 units in the current sheet give exactly the sheet's counts (2,458 questions).

## Translation providers

Choose the provider in **Settings → Translation provider** and paste that provider's key:

| Provider | Get a key | Quality for school math | Notes |
| --- | --- | --- | --- |
| **Claude** (default) | [console.anthropic.com](https://console.anthropic.com) → API keys | Best: natural, grade-appropriate wording; follows the glossary | `claude-opus-5-5` by default; refusal fallback enabled |
| **Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Good; follows the glossary | Model `gemini-3.8-flash` by default (low thinking level, auto-retry when Google is busy), changeable in Settings |
| **Google Translate** | Google Cloud Console → enable **Cloud Translation API** → Credentials → **Create API key** | Literal machine translation; may sound unnatural; glossary not used | Cheapest; supports Urdu (`ur`) and Sindhi (`sd`) |

All three get the same protection:
- Formulas are replaced with placeholders (`⟦M1⟧`) before the text leaves the browser and put back afterwards. Google Translate also sees them wrapped in `translate="no"`.
- If a provider loses or changes a formula, the suggestion is rejected and the teacher sees a message instead of a broken draft.
- Sentences the teacher has already sent are reused from translation memory without calling any provider.

The **Glossary** (Settings) holds `English = Urdu` lines so terms are translated the same way every time. Claude and Gemini use it; Google Translate doesn't.

**Cost with Claude:** roughly 2–5 US cents per question with the default model, about $50–130 for all 2,585 pending Urdu questions. You can switch the model in Settings; e.g. `claude-haiku-5-5` is far cheaper. Gemini and Google Translate are priced by Google, per token and per character respectively.

### Restricting Google keys

In Google Cloud Console → Credentials → your key, set:
- **API restrictions:** only **Generative Language API** (Gemini) or **Cloud Translation API**.
- **Quota or budget alerts**, so a leaked key can't run up a bill.

### Sharing one key with all teachers

An admin can put a key in `extension/config.json` before sharing the folder, so teachers don't need their own. Set `provider` (`claude`, `gemini` or `google`) and the matching field: `apiKey`, `geminiKey` or `googleKey`.

**Anyone who has the extension folder can read that key.** Use a separate key with a spend limit, and rotate it if it leaks. A small server that holds the key would be safer for wide distribution; that would be a future addition.

## How it talks to the portal

It uses the same API calls as the portal's translator screen, so reviewers see exactly what a manual submission produces:

| Step | Call |
| --- | --- |
| Log in | `POST /api/login` |
| Find a unit's questions | `GET /api/translator/questions?unit[]=<unit>&translation_status[]=pending_urdu_translation&translation_status[]=urdu_rejected&per_page=100&page=N`, then filtered by class and subject in the extension (the portal's own subject/class filters return nothing when combined with the unit filter) |
| Load a question | `GET /api/questions/{id}` |
| Send for review | `POST /api/translator/questions/{id}/submit` (multipart: `question_text_urdu`, `solution_steps_urdu[i][explanation]`, `solution_steps_urdu[i][images][]`, `pending_for_urdu_translation_review`, `translation_statuses[urdu]=pending_review`) |
| Step images | downloaded from `https://virtual.sundarstem.edu.pk/storage/<path>` |

Sindhi uses the matching `*_sindhi` fields.

Answer options and fill-in labels are not sent, because the portal's translator screen has no Urdu fields for them.

The portal sits behind Cloudflare, which blocks scripted clients. A browser extension works because its requests come from the teacher's real browser.

## Development

```bash
npm install
```

```bash
npm run build
```

`npm run build` bundles `src/ai.js` with the Anthropic SDK into `extension/lib/ai.bundle.js` and copies KaTeX into `extension/vendor/`. Both outputs are committed so teachers can load the folder directly.

```bash
npm test
```

```bash
TRANSLATOR_EMAIL=... TRANSLATOR_PASSWORD=... npm run e2e
```

```bash
REVIEWER_EMAIL=... REVIEWER_PASSWORD=... node tests/e2e/reviewer.mjs
```

The end-to-end tests:
- load the unpacked extension in Chromium
- log into the real portal and read real questions
- intercept the submit call and the approve / send-back calls, so nothing is really sent or reviewed, and block any other write
- fake the translation providers

Screenshots go to `tests/e2e/out/`.
