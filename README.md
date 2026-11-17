# ResuMail

Upload your resume, get a polished introduction written from it (rule-based, **no AI**), and email it, with your resume attached, to every recruiter on your list. Each person gets their own personal email. Free, private, and no build step.

## Features

- **Resume analysis (offline, no AI):** detects your name, contacts, skills (240+ keywords), experience, education and certifications, then scores you against 29 role profiles and writes your intro.
- **Manual mode:** skip the analysis and write your own intro.
- **Recipient lists:** Excel (.xlsx/.xls), CSV, TXT, or paste. Name, company and role columns are detected, duplicates and invalid emails are removed, and the company is guessed from the email domain.
- **Mail merge:** `{{first_name}}`, `{{company}}`, `{{role}}`, `{{intro}}`, `{{my_name}}` and more, with fallbacks such as `{{company|your organization}}`.
- **Safe sending:** one email per recipient, a configurable gap, auto-retry, pause/resume/stop, progress and ETA, a downloadable CSV report, and protection against sending twice.
- **Providers:** Gmail, Yahoo, Zoho, Brevo, or any SMTP server.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
# open http://localhost:3000
```

## Deploy free

See **docs/ResuMail-Production-Guide.pdf** (also served at `/guide.pdf`). Short version for Vercel: push to GitHub, import the repo at vercel.com/new, keep the defaults, and click Deploy.

## Project layout

```
server.js            Express server (local / Render / any Node host)
api/*.js             Vercel serverless functions (same handlers)
lib/handlers.js      API: /api/health, /api/config, /api/verify, /api/send
public/index.html    UI
public/app.js        UI logic
public/analyzer.js   Resume analyzer (rule based)
public/merge.js      Recipient parser + mail merge
public/vendor/       pdf.js, mammoth, SheetJS (served locally)
```

## Optional server-side sender

Copy `.env.example` to `.env` and set `SMTP_USER`, `SMTP_PASS` and `ACCESS_KEY`. The UI then offers "Server sender", which only works for people who know the access key.
