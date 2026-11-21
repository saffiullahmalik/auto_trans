# SundarSTEM Translation Assistant

A Chrome extension that helps teachers translate their assigned SundarSTEM math questions into **Urdu** (and **Sindhi**) and send them for review.

1. The teacher logs in with their own portal translator account.
2. They paste the whole **Question ID** column from their assignment sheet.
3. For each question the extension shows the English on the left and an editable Urdu draft on the right. The draft comes from AI, or from the teacher's own earlier translations.
4. The teacher corrects it and presses **Ctrl+Enter**. The extension attaches the step images and sends the question for review on the portal, then opens the next question.

## Install (for teachers)

1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Open `chrome://extensions` in Chrome or Edge and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin the extension and click its icon. The assistant opens in a new tab.

## Using it

- **Log in** with your portal email and password. The portal allows one login per account at a time, so logging in here signs you out of the portal in other tabs (and vice versa). If that happens mid-work, the extension asks for your password again and keeps your drafts.
- **Paste IDs:** copy the whole column from Excel or Google Sheets, header included. Blank cells, duplicates and text such as "Question ID" are handled automatically.
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

## AI suggestions (Claude)

Suggestions come from the Claude API (`claude-opus-5-5` by default). This needs an Anthropic API key, entered in **Settings**.

- Formulas are replaced with placeholders before the text is sent to the AI and put back afterwards, so the AI cannot change any math.
- Requests use server-side refusal fallback (`fallbacks: "default"`). If the main model declines a request, the API retries it on a fallback model.
- **Glossary** (Settings): add `English = Urdu` lines so terms are translated the same way every time.
- **Cost:** roughly 2–5 US cents per question with the default model (about $50–130 for all 2,585 pending Urdu questions). You can switch the model in Settings, e.g. `claude-haiku-5-5` is far cheaper.

### Sharing one key with all teachers

An admin can put a key in `extension/config.json` (`"apiKey": "sk-ant-..."`) before sharing the folder, so teachers don't need their own. **Anyone who has the extension folder can read that key.** Use a separate key with a monthly spend limit set in the Anthropic Console, and rotate it if it leaks. A small server that holds the key would be safer for wide distribution; that would be a future addition.

## How it talks to the portal

It uses the same API calls as the portal's translator screen, so reviewers see exactly what a manual submission produces:

| Step | Call |
| --- | --- |
| Log in | `POST /api/login` |
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

The end-to-end test:
- loads the unpacked extension in Chromium
- logs into the real portal and reads real questions
- intercepts the submit call (nothing is sent to review) and blocks any other write
- fakes the Claude API

Screenshots go to `tests/e2e/out/`.
