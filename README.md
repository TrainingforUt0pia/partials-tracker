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
- Entries, targets and handoff drafts are kept on the phone until the person signs out (or the session ends), then erased. The pick report and its ticks are kept in memory only, so they are gone when the app is closed or reloaded. Use Export to Excel before signing out if a copy is needed. Nothing stays on the phone after sign-out except the app files and the light or dark choice.
- Only supervisors can set the daily target: in the Admin page (Daily target card: pick a date and a number, Set target) or in the Weigher view ("Required partials for this day"). It is stored in the Sheet tab Targets (date, value, who, when); the newest value on or before a date applies. Weighers and supervisors see it read-only on weighers' phones, and the script stamps each saved entry with the target in force for its date, ignoring anything the phone sends.
- Each saved weighing entry (who, shift, partials weighed, batch total, target, time) is also sent to the Sheet (tab Entries) so the daily report can use it; if there is no signal it waits on the phone and is sent later. Removing an entry marks it "removed" in the Sheet instead of deleting it. The pick report, product names and lot numbers never leave the phone.
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

- 2026-10-27: Material requests now use a free-text 'Materials requested' box (500 characters, required) instead of the item dropdown; the puller sees the text and gets a beep, vibration and message when a new request arrives while the app is open (a flashing tab title if it is in the background). Script limit raised to 500 (redeploy needed). Cache v10. Not pushed.

- 2026-10-28: Admin page shows only the last 5 sign-ins (script sends 5 rows; optional redeploy). Hosting decision: staying on public GitHub Pages for now (option 1); alternatives are Cloudflare Pages + Access, company IT hosting. Badge ID roster (20 four-digit IDs, 11 assigned) kept outside the repo. Cache v11.

## Report by email (formatted Excel workbook, sent with a button)
A supervisor opens the Admin page, picks a From and To time (or taps "Last full day" or "Today so far"), and taps **Email report** twice to confirm. The script builds an Excel workbook for that period and emails it to the supervisors (`TO`). Nothing is sent on a schedule, so reports can go out any time and as often as needed (up to 20 a day, periods up to 7 days). Tabs: Summary (totals, weighers with completion colors, pullers' wait times, chart), Monthly shifts (month to date: Day vs Evening vs Night totals, completion, a month-total bar chart and a chart through the month in 7-day parts), Weekly comparison (Monday to Sunday, week to date: weighers ranked side by side with shifts worked, average per shift, completion, share of the team and difference from the team average, plus a day-by-day grid and chart), Weighed, Material requests, Sign-ins. The 6 AM start is only the default offered (`REPORT_HOUR` in the script).
1. Paste the newest `google-script.gs`, keep your `TO` and `FIRST_SUPERVISOR` lines, save.
2. In Project Settings check the time zone is the plant's (report times and labels follow it).
3. Run `testReport` once from the editor if you want a test email; the first run asks for permission to create files in Drive and send mail.
4. Deploy > Manage deployments > pencil > New version > Deploy.

A note on IDs: all-digit badge IDs such as 2614 are stored as plain text in the Sheet (the script formats the ID columns as text and always compares IDs as text). An older version stored them as numbers, which made those people unable to sign in, reset or revoke.
