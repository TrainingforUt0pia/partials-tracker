# Partials Tracker

Track partials weighed per shift against a daily target, with a weigher view and a puller view. Works on iPhone, Android and desktop, and installs to the home screen.

## Signing in
- Everyone signs in with their own **ID** and a **6-digit PIN** that a supervisor gives them. There is no shared PIN.
- The first time a PIN is used, the person must read the **acknowledgment letter** to the end, tick that they understand it, type their full name and draw their signature. The signature is saved as an image in Google Drive, with a record row (time stamped by the script, person, letter version, a hash of the letter text, device) in the Sheet.
- If the letter is changed (its Version cell in the Sheet), everyone is asked to sign again. The script refuses every action until the current letter is signed.
- Roles: **weigher**, **puller**, **supervisor**. The script checks the role on every action. A supervisor can switch between Admin, Weigher and Puller views.
- A wrong PIN five times locks that ID for 15 minutes. A signed-in session lasts 12 hours, then the phone signs out and erases its data.
- This is a PIN plus a typed name and drawn signature. It is a clear, time-stamped acknowledgment, not a validated 21 CFR Part 11 signature system. Ask Quality whether it is enough for your records.

## Weigher view
- **Required partials for this day:** set the daily target. It carries forward until changed.
- **Log a shift:** weigher name, shift, partials weighed, partials in the batch. Completion % = partials weighed / that day's target.
- **Items To Weigh:** load a pick report (.xlsx or .xlsm) and tick each ingredient off as it is weighed. The time of each tick is saved.
- **Material requests:** tap **Partials requested** when out of material. A timer runs until the puller taps Delivered. The weigher cannot stop the timer.
- **Shift Handoff:** notes for the next shift, emailed to the supervisors with the weigher, shift, partials weighed against target, and items still to weigh. The email also names the verified sender from the PIN sign-in.
- **Day summary, entries, Export to Excel / CSV, Copy backup / Restore.**

## Puller view
- **Requests waiting:** every open request with a **Delivered** button (tap twice to confirm). Nobody can deliver their own request.
- **Items To Pull:** load the same pick report and tick ingredients off as they are pulled.

## Admin view (supervisors)
- **People and PINs:** add a person (ID, name, role). A 6-digit PIN is created and shown once. Reset a PIN, or revoke or restore access. Revoking ends their session at once. PINs are stored only as a keyed hash, never in plain text.
- Shows who has and has not signed the current letter, and the most recent sign-ins.
- To change the letter, edit the **Letter** tab in the Google Sheet and change its Version cell.

## How the data is stored
- Entries, targets and handoff drafts are kept on the phone only until the person signs out (or the session ends), then erased. The pick report and its ticks are kept in memory only, so they are gone when the app is closed or reloaded. Use Export to Excel before signing out if a copy is needed. Nothing stays on the phone after sign-out except the app files and the light or dark choice.
- People, acknowledgments, sign-ins and material requests are stored in a Google Sheet by the Google script ("Partials Tracker Records" in the script owner's Drive, tabs People, Acknowledgments, Sign-ins, Requests, Letter). Signature images go in the Drive folder "Partials Tracker Signatures".
- The script stamps every time, checks every PIN and role, and gives a weigher phone only that person's own requests.
- Phones ask the script for news every 10 seconds while someone is looking at the screen and something is waiting.
- Export to Excel has sheets for Partials, Material requests (that person's own) and Batch items.

## Google script setup (free)
One Google Apps Script does everything on the server side. Supervisor addresses and the first supervisor's details live inside the script, never in this repo.
1. Sign in to script.google.com as the Gmail account that should own it and open the project.
2. Replace everything with `google-script.gs`. Set `TO` (supervisor email addresses) and the `FIRST_SUPERVISOR_ID` and `FIRST_SUPERVISOR_NAME` lines.
3. Select `setup` and click **Run**. Approve the permissions (Sheets, Drive, email). It creates the tabs and the draft Letter.
4. Select `createFirstSupervisor` and click **Run**. Open **View > Logs** and write down the first supervisor's PIN. It is not shown again. `resetFirstSupervisorPin` makes a new one if it is lost.
5. Deploy > Manage deployments > pencil > New version > Deploy. The web address stays the same.
6. Sign in to the app as that supervisor, sign the letter, and add everyone else in Admin.

Older tabs from earlier versions are renamed "(old ...)" automatically. After editing the script, redeploy a new version for the change to apply.

Safety checks in the script: every action but sign-in needs a valid session and the right role; handoffs only in the app's format, no links or email addresses (the app strips them first), 10 handoff emails an hour and 40 a day, 120 requests an hour; text that starts with = + - or @ is stored as plain text so it cannot run as a spreadsheet formula.

While `scriptUrl` in `handoff-config.js` is empty, nobody can sign in.

## Files
- `index.html`: the whole app
- `handoff-config.js`: web app URL of the Google script
- `google-script.gs`: the Google Apps Script (placeholder addresses only)
- `acknowledgment-letter-draft.md`: the DRAFT letter wording for Quality and Legal to review
- `manifest.webmanifest`, `sw.js`, `icon-*.png`: home-screen install and offline cache (the icon is a plain KPI wordmark)

Bump `CACHE` in `sw.js` when `index.html` changes so phones pick up the new version.

Do not commit real batch, product or lot data to this public repo. Test with made-up names.

## Install on a phone
Open the site in Safari (iPhone) or Chrome (Android), then Share > Add to Home Screen (iPhone) or Install app (Android).
