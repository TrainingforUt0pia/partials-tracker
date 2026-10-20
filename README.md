# Partials Tracker

Track partials weighed per shift against a daily target, with a weigher view and a puller view. Works on iPhone, Android and desktop, and installs to the home screen.

## Weigher view
- **Required partials for this day:** set the daily target. It carries forward until changed.
- **Log a shift:** weigher name, shift, partials weighed, LOT/IM number, batch name, partials in the batch. Completion % = partials weighed / that day's target.
- **Items To Weigh:** load a pick report (.xlsx or .xlsm) and tick each ingredient off as it is weighed. The time of each tick is saved.
- **Material requests:** tap **Partials requested** when out of material. A timer runs until the puller taps Delivered. The weigher cannot stop the timer.
- **Day summary, entries, Export to Excel / CSV, Copy backup / Restore.**

## Puller view
- Switch with the **Weigher | Puller** control at the top. Puller view asks for a name and a PIN.
- **Requests waiting:** every open request with a **Delivered** button (tap twice to confirm).
- **Items To Pull:** load the same pick report and tick ingredients off as they are pulled.

## How the data is stored
- Entries, targets, batches and ticked items are saved on each device only. Use Export to Excel regularly.
- Material requests are the only shared data. They live in Firebase (Firestore) so the puller's phone sees them and ends the timer.
- Request start and delivery times are stamped by the server. A phone cannot deliver its own request. The PIN is a deterrent, and each delivery records the puller's name.
- Export to Excel has sheets for Partials, Material requests and Batch items.

## Firebase setup
1. Create a Firebase project. Turn on **Authentication > Anonymous** and add the site's domain to Authorized domains.
2. Create a **Firestore** database (production mode) and publish the rules in `firestore.rules`.
3. In Firestore create the document `config/puller` with a string field `pin`.
4. Register a web app and paste its `firebaseConfig` into `firebase-config.js`. The config is not a secret. Access is controlled by the rules.

While `firebase-config.js` has `window.FIREBASE_CONFIG = null`, everything works except material requests.

## Files
- `index.html`: the whole app
- `firebase-config.js`: Firebase web config
- `firestore.rules`: security rules to paste into Firestore
- `manifest.webmanifest`, `sw.js`, `icon-*.png`: home-screen install and offline cache

Bump `CACHE` in `sw.js` when `index.html` changes so phones pick up the new version.

Do not commit real batch, product or lot data to this public repo. Test with made-up names.

## Install on a phone
Open the site in Safari (iPhone) or Chrome (Android), then Share > Add to Home Screen (iPhone) or Install app (Android).
