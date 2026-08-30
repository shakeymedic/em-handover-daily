# Learning Events — Email-to-Site Pipeline

## How it works

1. **Anyone emails** `jaketurner2503@gmail.com` with subject starting `LEARNING:` followed by the learning point title
2. **A weekly scheduled task** (set up in this session) checks Gmail, parses new submissions, and commits them to `data/learning-events.json` in the GitHub repo
3. **Netlify auto-deploys** the updated repo — the point appears on the handover screen within minutes
4. **Moderation**: all submissions arrive with `active: false` — you flip to `true` in the JSON to publish

## Email format

```
To:      jaketurner2503@gmail.com
Subject: LEARNING: Propofol dose — be aware of anaphylaxis risk in soy allergy
Body:    Any additional detail you want shown on the site. Keep it brief — one
         or two sentences. Do NOT include patient-identifiable information.
         Category (optional): safety | resus | airway | tox | trauma | pem | stroke | ecg
```

Subject line becomes the title. Body becomes the detail. Category is parsed from the body if present.

## Netlify Function (direct web submission)

The site also supports direct submissions via `POST /.netlify/functions/submit-learning`:

```json
{
  "title": "Your learning point",
  "detail": "Additional context (optional, max 500 chars)",
  "category": "safety",
  "submitted_by": "Name (optional)"
}
```

### Required Netlify environment variables

Set these in **Netlify dashboard → Site settings → Environment variables**:

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | Personal access token with `repo` write scope for `shakeymedic/em-handover-daily-bhh` |
| `GITHUB_REPO` | `shakeymedic/em-handover-daily-bhh` |
| `GITHUB_BRANCH` | `main` |

Create the token at: https://github.com/settings/tokens/new — select `repo` scope only.

## Moderating submissions

Open `data/learning-events.json` in GitHub or locally. Change `"active": false` to `"active": true` for any entry you want to show. Push — Netlify redeploys automatically.

Entries older than 30 days are automatically hidden from the display (controlled by `display_days` in the JSON).
