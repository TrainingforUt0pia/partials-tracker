// Google Apps Script for Partials Tracker. One web address, four jobs:
//   1. Individual PIN sign-in for weighers, pullers and supervisors. Supervisors control who has access.
//   2. A first-use acknowledgment letter with a typed name and drawn signature, saved as a record.
//   3. Material requests, stored in a Google Sheet so the puller ends the timer.
//   4. The Shift Handoff email to the supervisors.
// Every action except sign-in needs a valid session, and the server checks the person's role.
//
// SETUP (once): paste this into a Google Apps Script project signed in as the Gmail account that owns it,
// fill in TO and the FIRST_SUPERVISOR lines below (in Apps Script only, never in the repo), then
//   1. run setup()                  (approve the permissions; it creates the Sheet and the Letter tab)
//   2. run createFirstSupervisor()  (the first supervisor PIN appears in View > Logs; write it down)
//   3. Deploy > Manage deployments > pencil > New version > Deploy
// After that, supervisors add people and PINs inside the app (Admin view).

var TO = "supervisor1@example.com,supervisor2@example.com";
var FIRST_SUPERVISOR_ID = "SUP1";
var FIRST_SUPERVISOR_NAME = "First Supervisor";

var PIN_LENGTH = 6;
var TOKEN_HOURS = 12;                   // how long someone stays signed in (one shift)
var MAX_FAILS = 5;                      // wrong PINs for one ID before it locks
var LOCK_MINUTES = 15;
var MAX_HANDOFF_PER_HOUR = 10;
var MAX_HANDOFF_PER_DAY = 40;
var MAX_REQUESTS_PER_HOUR = 120;
var MAX_ENTRIES_PER_DAY = 200;          // weighing entries one person can save in a day
var REPORT_HOUR = 6;                    // the report period the app offers first runs from this hour to the same hour next day
var MAX_REPORTS_PER_DAY = 20;           // report emails one day

var TABS = {
  requests: { name: "Requests", dateCols: ["B", "G"], headers: ["id", "requestedAt", "personId", "name", "item", "status", "deliveredAt", "deliveredById", "deliveredBy", "waitSeconds", "device"] },
  people:   { name: "People", dateCols: ["F", "H", "J"], headers: ["personId", "name", "role", "pinHash", "status", "createdAt", "createdBy", "lastSignIn", "ackVersion", "ackAt"] },
  acks:     { name: "Acknowledgments", dateCols: ["B"], headers: ["ackId", "signedAt", "personId", "registeredName", "typedName", "nameMatches", "role", "letterVersion", "letterHash", "device", "signatureFile", "method"] },
  entries:  { name: "Entries", dateCols: ["B", "L"], textCols: ["F"], headers: ["entryId", "savedAt", "personId", "registeredName", "typedName", "date", "shift", "done", "book", "target", "status", "removedAt", "device"] },
  targets:  { name: "Targets", dateCols: ["C"], textCols: ["A"], headers: ["date", "target", "setAt", "setById", "setBy"] },
  signins:  { name: "Sign-ins", dateCols: ["A"], headers: ["time", "personId", "result", "device"] },
  letter:   { name: "Letter" }
};

// links, web addresses, mailto: and email addresses
var LINK = /(https?:\/\/|ftp:\/\/|mailto:|www\.)|[\w.+-]+@[\w-]+\.[a-z]{2,}|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|co|us|ly|me|xyz|ru|info|biz|app|dev|link|site|online|top|click|cc|tk)\b/i;
var LINKS = /(https?:\/\/|ftp:\/\/|mailto:|www\.)\S*|[\w.+-]+@[\w-]+\.[a-z]{2,}|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|co|us|ly|me|xyz|ru|info|biz|app|dev|link|site|online|top|click|cc|tk)\b\S*/gi;

// DRAFT acknowledgment letter. It is copied into the Letter tab by setup() and is meant to be edited there
// by the company (QA, HR and legal must approve the final wording). Bump the version cell when the text changes
// and everyone is asked to sign again.
var LETTER_VERSION = "DRAFT-1";
var LETTER_TITLE = "Confidentiality, Data Integrity and Food Defense Acknowledgment";
var LETTER_DRAFT = [
  ["Purpose", "[COMPANY NAME] gives you access to internal tools that record production activity, materials and shift handoffs. Before you use them you must read and agree to the points below. This is a DRAFT and must be reviewed and approved by [COMPANY NAME] Quality, HR and Legal before use."],
  ["Confidential information and intellectual property", "Formulas, ingredient lists, batch and lot records, supplier and customer information, processes, methods, documents and data you see at work are confidential property of [COMPANY NAME]. Use them only for your assigned duties. Do not copy, photograph, record, send, post or take them out of the facility or off company systems. These duties continue after your employment ends and add to any confidentiality agreement you have signed."],
  ["Accurate and honest records", "Record only information that is true, complete and entered at the time the work is done. Never enter or change a record on behalf of another person, never backdate, and never alter or delete a record unless an approved procedure allows it. Report errors to your supervisor so they can be corrected properly. Falsifying a record can lead to discipline up to termination and may be unlawful."],
  ["Your PIN is your signature", "Your PIN identifies you. Do not share it, lend it, or write it where others can see it. Everything done with your PIN is treated as done by you. Tell your supervisor at once if you think someone else knows your PIN or has used it."],
  ["Food defense and food fraud", "Report to your supervisor or Quality immediately anything that looks wrong: signs of tampering, unexpected, substituted, diluted or mislabeled material, missing material, unauthorized people in the area, or anyone asking you to skip a check or change a record. Do not confront anyone yourself. [COMPANY NAME] will not retaliate against anyone who reports a concern in good faith."],
  ["Use of company tools", "Use these tools only for your assigned work. Do not try to get around access controls, use another person's account, or collect data you are not authorized to have. [COMPANY NAME] may monitor and audit use of these tools and the records in them."],
  ["Consequences", "Breaking these rules can lead to discipline up to and including termination, and to legal action. This applies whether or not you meant to break them."],
  ["Statement", "I have read and understand this acknowledgment and I agree to follow it. My typed name and drawn signature are my electronic signature and carry the same intent as my handwritten signature."]
];

// ---------------------------------------------------------------- setup helpers (run from the editor)

function setup() {
  var ss = spreadsheet();
  tab("requests"); tab("people"); tab("acks"); tab("signins"); tab("entries"); tab("targets");
  var lt = tab("letter");
  if (lt.getLastRow() === 0) seedLetter(lt);
  var s1 = ss.getSheetByName("Sheet1");
  if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
  pepper();
  Logger.log("Ready. Sheet: " + ss.getUrl());
}

function seedLetter(sh) {
  sh.appendRow(["Version", LETTER_VERSION]);
  sh.appendRow(["Title", LETTER_TITLE]);
  sh.appendRow(["Heading", "Text (the row headed Statement is the sentence people agree to)"]);
  LETTER_DRAFT.forEach(function (r) { sh.appendRow(r); });
  sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 700);
}

function createFirstSupervisor() {
  var id = normId(FIRST_SUPERVISOR_ID);
  if (findPerson(id)) { Logger.log("That ID already exists. Use resetFirstSupervisorPin() if the PIN was lost."); return; }
  var pin = newPin();
  addPersonRow(id, clean(FIRST_SUPERVISOR_NAME, 60), "supervisor", pin, "setup");
  Logger.log("First supervisor created. ID: " + id + "   PIN: " + pin + "   Write it down, it is not shown again.");
}

function resetFirstSupervisorPin() {
  var p = findPerson(normId(FIRST_SUPERVISOR_ID));
  if (!p) { Logger.log("No such supervisor. Run createFirstSupervisor() first."); return; }
  var pin = newPin();
  setPin(p, pin);
  Logger.log("New PIN for " + p.id + ": " + pin);
}

// ---------------------------------------------------------------- basics

function doGet() {
  return reply({ ok: true, info: "Partials Tracker script is running." });
}

function reply(obj) {
  obj.now = Date.now();
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// text that starts with = + - or @ would be run as a formula by Google Sheets, so it gets a leading apostrophe
function clean(v, max) {
  var t = String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").replace(LINKS, "[link removed]").trim().slice(0, max);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

function ms(v) { return v instanceof Date ? v.getTime() : (Number(v) || null); }
function normId(s) { return String(s || "").trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 32); }
function normName(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function validDevice(d) { return /^[A-Za-z0-9_-]{8,64}$/.test(String(d || "")); }

var _ss = null;
function spreadsheet() {
  if (_ss) return _ss;
  var props = PropertiesService.getScriptProperties(), id = props.getProperty("SHEET_ID");
  if (id) { _ss = SpreadsheetApp.openById(id); }
  else { _ss = SpreadsheetApp.create("Partials Tracker Records"); props.setProperty("SHEET_ID", _ss.getId()); }
  return _ss;
}

// returns the tab; a tab from an older layout is renamed "(old ...)" and a fresh one is made
function tab(key) {
  var ss = spreadsheet(), def = TABS[key], sh = ss.getSheetByName(def.name);
  if (sh && def.headers && sh.getLastRow() > 0) {
    var have = sh.getRange(1, 1, 1, def.headers.length).getValues()[0].join("|");
    if (have !== def.headers.join("|")) {
      sh.setName(def.name + " (old " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HHmmss") + ")");
      sh = null;
    }
  }
  if (!sh) {
    sh = ss.insertSheet(def.name);
    if (def.headers) {
      sh.appendRow(def.headers);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, def.headers.length).setFontWeight("bold");
      (def.dateCols || []).forEach(function (c) { sh.getRange(c + ":" + c).setNumberFormat("yyyy-mm-dd hh:mm:ss"); });
      (def.textCols || []).forEach(function (c) { sh.getRange(c + ":" + c).setNumberFormat("@"); });
    }
  }
  return sh;
}

function pepper() {
  var props = PropertiesService.getScriptProperties(), p = props.getProperty("PEPPER");
  if (!p) { p = Utilities.getUuid() + Utilities.getUuid(); props.setProperty("PEPPER", p); }
  return p;
}

// PINs are stored only as a keyed hash. The key lives in script properties, never in the Sheet.
function pinHash(id, pin) {
  return Utilities.base64Encode(Utilities.computeHmacSha256Signature(id + ":" + pin, pepper()));
}

function newPin() {
  for (var tries = 0; tries < 50; tries++) {
    var hex = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
    var n = (parseInt(hex.slice(0, 6), 16) * 4096 + parseInt(hex.slice(6), 16)) % Math.pow(10, PIN_LENGTH);
    var s = String(n); while (s.length < PIN_LENGTH) s = "0" + s;
    if (/^(\d)\1+$/.test(s) || "0123456789012".indexOf(s) >= 0 || "9876543210987".indexOf(s) >= 0) continue;
    return s;
  }
  return "482915";
}

// ---------------------------------------------------------------- people and sessions

var P = { id: 0, name: 1, role: 2, hash: 3, status: 4, created: 5, by: 6, last: 7, ackV: 8, ackAt: 9 };

function readPeople() {
  var sh = tab("people"), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 10).getValues().map(function (r, i) {
    return { row: i + 2, id: r[P.id], name: r[P.name], role: r[P.role], hash: r[P.hash], status: r[P.status], created: ms(r[P.created]), last: ms(r[P.last]), ackVersion: r[P.ackV], ackAt: ms(r[P.ackAt]) };
  });
}

function findPerson(id) {
  var people = readPeople();
  for (var i = 0; i < people.length; i++) if (people[i].id === id) return people[i];
  return null;
}

function addPersonRow(id, name, role, pin, by) {
  tab("people").appendRow([id, name, role, pinHash(id, pin), "active", new Date(), by, "", "", ""]);
}

function setPin(p, pin) {
  tab("people").getRange(p.row, P.hash + 1).setValue(pinHash(p.id, pin));
  CacheService.getScriptCache().remove("fail:" + p.id);
  endSessions(p.id);
}

function startSession(p) {
  var props = PropertiesService.getScriptProperties(), now = Date.now();
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {                    // tidy up expired sessions
    if (k.indexOf("s:") === 0) { try { if (JSON.parse(all[k]).e < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); } }
  });
  var token = Utilities.getUuid() + Utilities.getUuid();
  props.setProperty("s:" + token, JSON.stringify({ p: p.id, n: p.name, r: p.role, a: p.ackVersion, e: now + TOKEN_HOURS * 3600000 }));
  return token;
}

function endSessions(id) {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf("s:") === 0) { try { if (JSON.parse(all[k]).p === id) props.deleteProperty(k); } catch (e) {} }
  });
}

function getSession(token) {
  token = String(token || "");
  if (!/^[0-9a-f-]{70,74}$/.test(token)) return null;
  var props = PropertiesService.getScriptProperties(), raw = props.getProperty("s:" + token);
  if (!raw) return null;
  var s = JSON.parse(raw);
  if (s.e < Date.now()) { props.deleteProperty("s:" + token); return null; }
  return { token: token, id: s.p, name: s.n, role: s.r, ackVersion: s.a };
}

function logSignin(id, result, device) {
  tab("signins").appendRow([new Date(), id, result, validDevice(device) ? device : ""]);
}

function login(d) {
  var id = normId(d.id), pin = String(d.pin || "").trim(), cache = CacheService.getScriptCache(), key = "fail:" + id;
  if (id.length < 2 || !pin) return { ok: false, error: "credentials" };
  var fails = Number(cache.get(key) || 0);
  if (fails >= MAX_FAILS) return { ok: false, error: "locked" };
  var p = findPerson(id);
  var good = p && p.hash === pinHash(p.id, pin);
  if (!good || p.status !== "active") {
    cache.put(key, String(fails + 1), LOCK_MINUTES * 60);
    if (p) logSignin(id, good ? "revoked" : "wrong PIN", d.device);   // only real IDs are logged, so outsiders cannot flood the log
    return { ok: false, error: "credentials" };
  }
  cache.remove(key);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    tab("people").getRange(p.row, P.last + 1).setValue(new Date());
    logSignin(id, "signed in", d.device);
    var token = startSession(p);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, token: token, person: { id: p.id, name: p.name, role: p.role }, needsAck: p.ackVersion !== letterVersion() };
}

// ---------------------------------------------------------------- the letter

function readLetter() {
  var sh = tab("letter");
  if (sh.getLastRow() === 0) seedLetter(sh);
  var vals = sh.getDataRange().getValues(), sections = [], statement = "";
  for (var i = 3; i < vals.length; i++) {
    var h = String(vals[i][0] || "").trim(), t = String(vals[i][1] || "").trim();
    if (!t) continue;
    if (h.toLowerCase() === "statement") statement = t; else sections.push({ h: h, t: t });
  }
  return { version: String(vals[0][1] || ""), title: String(vals[1][1] || ""), sections: sections, statement: statement };
}

function letterVersion() {
  var cache = CacheService.getScriptCache(), v = cache.get("lv");
  if (!v) { v = readLetter().version; cache.put("lv", v, 60); }
  return v;
}

function letterHash(L) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify([L.version, L.title, L.sections, L.statement])));
}

function signaturesFolder() {
  var it = DriveApp.getFoldersByName("Partials Tracker Signatures");
  return it.hasNext() ? it.next() : DriveApp.createFolder("Partials Tracker Signatures");
}

function acknowledge(d, s) {
  var L = readLetter();
  if (String(d.version) !== L.version) return { ok: false, error: "version" };
  var typed = clean(d.typedName, 80);
  if (typed.length < 3) return { ok: false, error: "name" };
  var sig = String(d.signature || "");
  if (!/^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(sig) || sig.length < 400 || sig.length > 150000) return { ok: false, error: "signature" };
  var p = findPerson(s.id);
  if (!p || p.status !== "active") return { ok: false, error: "auth" };

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
  var blob = Utilities.newBlob(Utilities.base64Decode(sig.split(",")[1]), "image/png", p.id + "_" + L.version + "_" + stamp + ".png");
  var file = signaturesFolder().createFile(blob);
  var now = new Date();
  tab("acks").appendRow([Utilities.getUuid().replace(/-/g, "").slice(0, 12), now, p.id, p.name, typed, normName(typed) === normName(p.name) ? "yes" : "NO", p.role, L.version, letterHash(L), validDevice(d.device) ? d.device : "", file.getUrl(), "PIN + typed name + drawn signature"]);
  var sh = tab("people");
  sh.getRange(p.row, P.ackV + 1, 1, 2).setValues([[L.version, now]]);
  var props = PropertiesService.getScriptProperties(), raw = JSON.parse(props.getProperty("s:" + s.token));
  raw.a = L.version; props.setProperty("s:" + s.token, JSON.stringify(raw));
  return { ok: true };
}

// ---------------------------------------------------------------- routing

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents), a = String(d.action || "");
    if (a === "login") return reply(login(d));
    var s = getSession(d.token);
    if (!s) return reply({ ok: false, error: "auth" });
    if (a === "me") return reply({ ok: true, person: { id: s.id, name: s.name, role: s.role }, needsAck: s.ackVersion !== letterVersion() });
    if (a === "letter") return reply({ ok: true, letter: readLetter() });
    if (a === "acknowledge") {
      var lock0 = LockService.getScriptLock(); lock0.waitLock(10000);
      try { return reply(acknowledge(d, s)); } finally { lock0.releaseLock(); }
    }
    if (s.ackVersion !== letterVersion()) return reply({ ok: false, error: "ack" });   // must sign the current letter first
    return reply(route(a, d, s));
  } catch (err) {
    return reply({ ok: false, error: "failed" });
  }
}

function can(s, roles) { return roles.indexOf(s.role) >= 0; }

function route(a, d, s) {
  var WEIGHER = ["weigher", "supervisor"], PULLER = ["puller", "supervisor"], ADMIN = ["supervisor"];
  if (a === "mine") return can(s, WEIGHER) ? mine(s) : { ok: false, error: "role" };
  if (a === "open") return can(s, PULLER) ? openRequests() : { ok: false, error: "role" };
  if (a === "people") return can(s, ADMIN) ? listPeople() : { ok: false, error: "role" };
  if (a === "targets") return can(s, WEIGHER) ? { ok: true, targets: targetMap() } : { ok: false, error: "role" };
  if (a === "signins") return can(s, ADMIN) ? recentSignins() : { ok: false, error: "role" };
  if (a === "sendReport") return can(s, ADMIN) ? sendReport(d, s) : { ok: false, error: "role" };
  var need = { request: WEIGHER, cancel: WEIGHER, handoff: WEIGHER, saveEntry: WEIGHER, removeEntry: WEIGHER, setTarget: ADMIN, deliver: PULLER, addPerson: ADMIN, resetPin: ADMIN, setStatus: ADMIN };
  if (!need[a]) return { ok: false, error: "action" };
  if (!can(s, need[a])) return { ok: false, error: "role" };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (a === "request") return addRequest(d, s);
    if (a === "cancel") return cancelRequest(d, s);
    if (a === "deliver") return deliver(d, s);
    if (a === "handoff") return handoff(d, s);
    if (a === "saveEntry") return saveEntry(d, s);
    if (a === "setTarget") return setTarget(d, s);
    if (a === "removeEntry") return removeEntry(d, s);
    if (a === "addPerson") return addPerson(d, s);
    if (a === "resetPin") return resetPin(d, s);
    if (a === "setStatus") return setStatus(d, s);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- Shift Handoff email

function handoff(d, s) {
  var subject = String(d.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 150);
  var message = String(d.message || "").trim().slice(0, 6000);
  if (!subject || !message) return { ok: false, error: "empty" };
  if (subject.indexOf("Shift Handoff:") !== 0 || message.indexOf("Shift Handoff\nWeigher: ") !== 0 || message.indexOf("\nNotes:\n") < 0) return { ok: false, error: "format" };
  if (LINK.test(subject) || LINK.test(message)) return { ok: false, error: "link" };

  var props = PropertiesService.getScriptProperties();
  var now = Date.now(), day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var st = JSON.parse(props.getProperty("rate") || "{}");
  if (!st.hourStart || now - st.hourStart > 3600000) { st.hourStart = now; st.hourCount = 0; }
  if (st.day !== day) { st.day = day; st.dayCount = 0; }
  if (st.hourCount >= MAX_HANDOFF_PER_HOUR || st.dayCount >= MAX_HANDOFF_PER_DAY) return { ok: false, error: "limit" };
  st.hourCount++; st.dayCount++;
  props.setProperty("rate", JSON.stringify(st));

  var sender = "\n\nVerified sender: " + s.name + " (" + s.id + ", " + s.role + ")";
  var footer = "\n---\nSent by the Partials Tracker app. The verified sender above comes from the PIN sign-in. Real handoffs never contain links or email addresses. If this one does, or looks wrong, do not trust it.";
  MailApp.sendEmail({ to: TO, subject: "[Partials Tracker] " + subject, body: message + sender + footer, name: "Partials Tracker" });
  return { ok: true };
}

// ---------------------------------------------------------------- Material requests

// the most recent rows only, so the sheet can grow without slowing the app down
function recentRows(sh) {
  var last = sh.getLastRow();
  if (last < 2) return { start: 2, rows: [] };
  var start = Math.max(2, last - 499);
  return { start: start, rows: sh.getRange(start, 1, last - start + 1, TABS.requests.headers.length).getValues() };
}

var R = { id: 0, at: 1, pid: 2, name: 3, item: 4, status: 5, done: 6, byId: 7, by: 8, wait: 9, device: 10 };

function toObj(r) {
  return { id: r[R.id], at: ms(r[R.at]), pid: r[R.pid], name: r[R.name], item: r[R.item], status: r[R.status], done: ms(r[R.done]), by: r[R.by] || "" };
}

function mine(s) {
  var cutoff = Date.now() - 3 * 86400000;
  var list = recentRows(tab("requests")).rows.map(toObj).filter(function (o) { return o.pid === s.id && o.at && o.at >= cutoff; });
  list.forEach(function (o) { delete o.pid; });
  return { ok: true, list: list };
}

function addRequest(d, s) {
  var props = PropertiesService.getScriptProperties(), now = Date.now();
  var st = JSON.parse(props.getProperty("reqrate") || "{}");
  if (!st.hourStart || now - st.hourStart > 3600000) { st.hourStart = now; st.hourCount = 0; }
  if (st.hourCount >= MAX_REQUESTS_PER_HOUR) return { ok: false, error: "limit" };
  var sh = tab("requests"), rows = recentRows(sh).rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][R.status] === "open" && rows[i][R.pid] === s.id) return { ok: false, error: "open" };
  }
  st.hourCount++;
  props.setProperty("reqrate", JSON.stringify(st));
  var id = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  sh.appendRow([id, new Date(now), s.id, s.name, clean(d.item, 500), "open", "", "", "", "", validDevice(d.device) ? d.device : ""]);
  return { ok: true, id: id, at: now };
}

function findRequest(sh, id) {
  var r = recentRows(sh);
  for (var i = 0; i < r.rows.length; i++) {
    if (r.rows[i][R.id] === id) return { row: r.start + i, values: r.rows[i] };
  }
  return null;
}

function cancelRequest(d, s) {
  var sh = tab("requests"), hit = findRequest(sh, String(d.id || ""));
  if (!hit || hit.values[R.pid] !== s.id || hit.values[R.status] !== "open") return { ok: false, error: "closed" };
  sh.getRange(hit.row, R.status + 1).setValue("cancelled");
  return { ok: true };
}

function openRequests() {
  var rows = recentRows(tab("requests")).rows.map(toObj);
  var open = rows.filter(function (o) { return o.status === "open"; }).map(function (o) { delete o.pid; return o; });
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  var waits = [], count = 0;
  rows.forEach(function (o) {
    if (o.at && o.status !== "cancelled" && Utilities.formatDate(new Date(o.at), tz, "yyyy-MM-dd") === today) {
      count++;
      if (o.status === "delivered" && o.done) waits.push((o.done - o.at) / 1000);
    }
  });
  var sum = waits.reduce(function (t, w) { return t + w; }, 0);
  return { ok: true, open: open, today: { count: count, avgSec: waits.length ? sum / waits.length : null, maxSec: waits.length ? Math.max.apply(null, waits) : null } };
}

function deliver(d, s) {
  var sh = tab("requests"), hit = findRequest(sh, String(d.id || ""));
  if (!hit || hit.values[R.status] !== "open") return { ok: false, error: "closed" };
  if (hit.values[R.pid] === s.id) return { ok: false, error: "same" };      // nobody can deliver their own request
  var now = Date.now();
  sh.getRange(hit.row, R.status + 1, 1, 5).setValues([["delivered", new Date(now), s.id, s.name, Math.round((now - ms(hit.values[R.at])) / 1000)]]);
  return { ok: true };
}

// ---------------------------------------------------------------- supervisor administration

function listPeople() {
  var v = letterVersion();
  return { ok: true, letterVersion: v, people: readPeople().map(function (p) {
    return { id: p.id, name: p.name, role: p.role, status: p.status, last: p.last, ackVersion: p.ackVersion, ackAt: p.ackAt, needsAck: p.ackVersion !== v };
  }) };
}

function recentSignins() {
  var sh = tab("signins"), n = sh.getLastRow();
  if (n < 2) return { ok: true, list: [] };
  var start = Math.max(2, n - 4);
  var list = sh.getRange(start, 1, n - start + 1, 4).getValues().map(function (r) { return { at: ms(r[0]), id: r[1], result: r[2] }; }).reverse();
  return { ok: true, list: list };
}

function addPerson(d, s) {
  var id = normId(d.id), name = clean(d.name, 60), role = String(d.role || "");
  if (id.length < 2 || !name) return { ok: false, error: "invalid" };
  if (["weigher", "puller", "supervisor"].indexOf(role) < 0) return { ok: false, error: "invalid" };
  if (findPerson(id)) return { ok: false, error: "exists" };
  var pin = newPin();
  addPersonRow(id, name, role, pin, s.id);
  return { ok: true, id: id, name: name, pin: pin };
}

function resetPin(d, s) {
  var p = findPerson(normId(d.id));
  if (!p) return { ok: false, error: "missing" };
  var pin = newPin();
  setPin(p, pin);
  return { ok: true, id: p.id, name: p.name, pin: pin };
}

function setStatus(d, s) {
  var p = findPerson(normId(d.id)), status = String(d.status || "");
  if (!p || ["active", "revoked"].indexOf(status) < 0) return { ok: false, error: "invalid" };
  if (p.id === s.id) return { ok: false, error: "self" };                   // a supervisor cannot lock themselves out
  tab("people").getRange(p.row, P.status + 1).setValue(status);
  if (status === "revoked") endSessions(p.id);
  return { ok: true };
}

// ---------------------------------------------------------------- Weighed counts (stored so the daily report can use them)

function intOrNull(v, max) {
  if (v === "" || v == null) return null;
  var n = Number(v);
  return isFinite(n) && n >= 0 && n <= max && n % 1 === 0 ? n : NaN;
}

// the most recent rows of any tab, with the sheet row number of the first one
function lastRows(sh, count, width) {
  var last = sh.getLastRow();
  if (last < 2) return { start: 2, rows: [] };
  var start = Math.max(2, last - count + 1);
  return { start: start, rows: sh.getRange(start, 1, last - start + 1, width).getValues() };
}

var E = { id: 0, at: 1, pid: 2, name: 3, typed: 4, date: 5, shift: 6, done: 7, book: 8, target: 9, status: 10, removedAt: 11, device: 12 };

function saveEntry(d, s) {
  var id = String(d.id || ""), date = String(d.date || ""), shift = String(d.shift || "");
  var done = intOrNull(d.done, 1000000), book = intOrNull(d.book, 1000000);
  if (!/^[a-z0-9]{6,24}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || ["Day", "Evening", "Night"].indexOf(shift) < 0 ||
      done === null || isNaN(done) || isNaN(book)) return { ok: false, error: "invalid" };
  var sh = tab("entries"), recent = lastRows(sh, 2000, TABS.entries.headers.length), target = targetOn(date);
  for (var i = 0; i < recent.rows.length; i++) if (recent.rows[i][E.id] === id) return { ok: true, duplicate: true };
  var day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var today = recent.rows.filter(function (r) { return r[E.pid] === s.id && Utilities.formatDate(new Date(ms(r[E.at])), Session.getScriptTimeZone(), "yyyy-MM-dd") === day; }).length;
  if (today >= MAX_ENTRIES_PER_DAY) return { ok: false, error: "limit" };
  sh.appendRow([id, new Date(), s.id, s.name, clean(d.name, 60), date, shift, done, book === null ? "" : book, target === null ? "" : target, "active", "", validDevice(d.device) ? d.device : ""]);
  return { ok: true };
}

// ---- targets: only supervisors set them; the newest value on or before a date applies to that date
function targetMap() {
  var m = {}, tz = Session.getScriptTimeZone();
  lastRows(tab("targets"), 400, TABS.targets.headers.length).rows.forEach(function (r) {
    var d = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, "yyyy-MM-dd") : String(r[0]), v = Number(r[1]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v > 0) m[d] = v;
  });
  return m;
}

function targetOn(date) {
  var m = targetMap(), best = null;
  Object.keys(m).forEach(function (k) { if (k <= date && (best === null || k > best)) best = k; });
  return best === null ? null : m[best];
}

function setTarget(d, s) {
  var date = String(d.date || ""), v = intOrNull(d.value, 1000000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || v === null || isNaN(v) || v < 1) return { ok: false, error: "invalid" };
  tab("targets").appendRow([date, v, new Date(), s.id, s.name]);
  return { ok: true };
}

// a removed entry stays in the sheet marked "removed", so nothing disappears from the record
function removeEntry(d, s) {
  var id = String(d.id || "");
  if (!/^[a-z0-9]{6,24}$/.test(id)) return { ok: false, error: "invalid" };
  var sh = tab("entries"), recent = lastRows(sh, 2000, TABS.entries.headers.length);
  for (var i = 0; i < recent.rows.length; i++) {
    var r = recent.rows[i];
    if (r[E.id] !== id) continue;
    if (r[E.pid] !== s.id && s.role !== "supervisor") return { ok: false, error: "role" };
    if (r[E.status] !== "removed") {
      sh.getRange(recent.start + i, E.status + 1).setValue("removed");
      sh.getRange(recent.start + i, E.removedAt + 1).setValue(new Date());
    }
    return { ok: true };
  }
  return { ok: true };       // it never reached the server, so there is nothing to mark
}

// ---------------------------------------------------------------- Daily report (formatted Excel workbook by email)

// the default report period: the 24 hours that ended at the most recent REPORT_HOUR o'clock (script time zone)
function reportWindow(now) {
  var end = new Date(now.getTime());
  end.setHours(REPORT_HOUR, 0, 0, 0);
  if (end.getTime() > now.getTime()) end.setDate(end.getDate() - 1);
  var start = new Date(end.getTime());
  start.setDate(start.getDate() - 1);
  return { start: start, end: end };
}

function inWindow(t, w) { return t !== null && t >= w.start.getTime() && t < w.end.getTime(); }
function sec2clock(s) { s = Math.round(s); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
// text the sheet could read as a formula is stored as plain text
function safe(v) { return typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v; }
function rowsOf(key) {
  var v = tab(key).getDataRange().getValues();
  v.shift();
  return v;
}

// everything in the window, gathered and totalled; no formatting here so it can be tested on its own
function reportData(w) {
  var tz = Session.getScriptTimeZone();
  var entries = [], removed = 0;
  rowsOf("entries").forEach(function (r) {
    if (!inWindow(ms(r[E.at]), w)) return;
    if (r[E.status] === "removed") { removed++; return; }
    var date = r[E.date] instanceof Date ? Utilities.formatDate(r[E.date], tz, "yyyy-MM-dd") : String(r[E.date]);
    entries.push({ at: ms(r[E.at]), pid: r[E.pid], name: r[E.name], typed: r[E.typed], date: date, shift: r[E.shift], done: Number(r[E.done]) || 0,
      book: r[E.book] === "" ? null : Number(r[E.book]), target: r[E.target] === "" ? null : Number(r[E.target]) });
  });
  entries.sort(function (a, b) { return a.at - b.at; });

  var reqs = [];
  rowsOf("requests").forEach(function (r) {
    var at = ms(r[R.at]);
    if (!inWindow(at, w)) return;
    var done = ms(r[R.done]);
    reqs.push({ at: at, name: r[R.name], item: r[R.item], status: r[R.status], done: done, by: r[R.by] || "", wait: r[R.status] === "delivered" && done ? Math.round((done - at) / 1000) : null });
  });
  reqs.sort(function (a, b) { return a.at - b.at; });

  var logins = [];
  rowsOf("signins").forEach(function (r) {
    var at = ms(r[0]);
    if (inWindow(at, w)) logins.push({ at: at, id: r[1], result: r[2] });
  });

  var byWeigher = {};
  entries.forEach(function (e) {
    var g = byWeigher[e.pid] = byWeigher[e.pid] || { name: e.name, entries: 0, done: 0, target: null };
    g.entries++; g.done += e.done;
    if (e.target !== null) g.target = Math.max(g.target || 0, e.target);
  });
  var weighers = Object.keys(byWeigher).map(function (k) { var g = byWeigher[k]; g.pct = g.target ? g.done / g.target : null; return g; })
    .sort(function (a, b) { return b.done - a.done; });

  var byPuller = {};
  reqs.filter(function (q) { return q.status === "delivered" && q.wait !== null; }).forEach(function (q) {
    var g = byPuller[q.by] = byPuller[q.by] || { name: q.by, count: 0, total: 0, max: 0 };
    g.count++; g.total += q.wait; g.max = Math.max(g.max, q.wait);
  });
  var pullers = Object.keys(byPuller).map(function (k) { var g = byPuller[k]; g.avg = g.total / g.count; return g; })
    .sort(function (a, b) { return b.count - a.count; });

  var waits = reqs.filter(function (q) { return q.wait !== null; }).map(function (q) { return q.wait; });
  return {
    entries: entries, removed: removed, reqs: reqs, logins: logins, weighers: weighers, pullers: pullers,
    totalDone: entries.reduce(function (a, e) { return a + e.done; }, 0),
    delivered: waits.length,
    cancelled: reqs.filter(function (q) { return q.status === "cancelled"; }).length,
    stillOpen: reqs.filter(function (q) { return q.status === "open"; }).length,
    avgWait: waits.length ? waits.reduce(function (a, c) { return a + c; }, 0) / waits.length : null,
    maxWait: waits.length ? Math.max.apply(null, waits) : null,
    signedIn: logins.filter(function (l) { return l.result === "signed in"; }).length,
    failedIn: logins.filter(function (l) { return l.result !== "signed in"; }).length
  };
}

var NAVY = "#1f6fa8", PALE = "#eaf3fa", GRID = "#d5dde5";

// header row + body rows in one call each, with banding and borders
function paintTable(sh, row, headers, body, formats) {
  var n = headers.length;
  var head = sh.getRange(row, 1, 1, n);
  head.setValues([headers]).setBackground(NAVY).setFontColor("#ffffff").setFontWeight("bold").setVerticalAlignment("middle").setWrap(true);
  if (body.length) {
    var rng = sh.getRange(row + 1, 1, body.length, n);
    rng.setValues(body.map(function (r) { return r.map(safe); })).setVerticalAlignment("middle");
    for (var i = 1; i < body.length; i += 2) sh.getRange(row + 1 + i, 1, 1, n).setBackground(PALE);
    (formats || []).forEach(function (f, c) { if (f) sh.getRange(row + 1, c + 1, body.length, 1).setNumberFormat(f); });
    rng.setBorder(true, true, true, true, true, true, GRID, SpreadsheetApp.BorderStyle.SOLID);
  }
  head.setBorder(true, true, true, true, true, true, GRID, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(row, 30);
}

function titleBand(sh, cols, title, sub) {
  sh.getRange(1, 1, 1, cols).setBackground(NAVY);
  sh.getRange(1, 1).setValue(title).setFontSize(18).setFontWeight("bold").setFontColor("#ffffff");
  sh.getRange(2, 1, 1, cols).setBackground(NAVY);
  sh.getRange(2, 1).setValue(sub).setFontColor("#dbeafe");
  sh.setRowHeight(1, 36);
}

function pctColor(p) { return p === null ? null : p >= 1 ? "#e5f4e4" : p >= 0.8 ? "#f9eeda" : "#fbebeb"; }

// ---- weekly comparison: Monday to Sunday of the week the report period ends in, week to date
function ymdParts(s) { var p = s.split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0); }

function weeklyData(w) {
  var tz = Session.getScriptTimeZone();
  // the work day a moment belongs to starts at REPORT_HOUR, so 3 AM Wednesday still counts as Tuesday
  var ref = new Date(w.end.getTime() - 1 - REPORT_HOUR * 3600000);
  var refDay = Utilities.formatDate(ref, tz, "yyyy-MM-dd");
  var back = Number(Utilities.formatDate(ref, tz, "u")) - 1;       // 1 = Monday ... 7 = Sunday
  var monday = ymdParts(refDay); monday.setDate(monday.getDate() - back);
  var days = [], dayKeys = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(monday.getTime()); d.setDate(d.getDate() + i);
    days.push(Utilities.formatDate(d, tz, "EEE d MMM")); dayKeys.push(Utilities.formatDate(d, tz, "yyyy-MM-dd"));
  }
  var byPerson = {};
  rowsOf("entries").forEach(function (r) {
    if (r[E.status] === "removed") return;
    var at = ms(r[E.at]);
    if (at === null || at >= w.end.getTime()) return;
    var date = r[E.date] instanceof Date ? Utilities.formatDate(r[E.date], tz, "yyyy-MM-dd") : String(r[E.date]);
    var di = dayKeys.indexOf(date);
    if (di < 0) return;
    var g = byPerson[r[E.pid]] = byPerson[r[E.pid]] || { name: r[E.name], entries: 0, done: 0, perDay: [0, 0, 0, 0, 0, 0, 0], shifts: {} };
    var done = Number(r[E.done]) || 0, target = r[E.target] === "" ? null : Number(r[E.target]);
    g.entries++; g.done += done; g.perDay[di] += done;
    var key = date + "|" + r[E.shift];                                // one target per shift worked, however many entries it took
    var sx = g.shifts[key] = g.shifts[key] || { t: 0, d: 0 };
    sx.t = Math.max(sx.t, target || 0); sx.d += done;
  });
  var rows = Object.keys(byPerson).map(function (k) {
    var g = byPerson[k], keys = Object.keys(g.shifts);
    g.shiftCount = keys.length;
    g.target = keys.reduce(function (a, x) { return a + g.shifts[x].t; }, 0);
    g.doneT = keys.reduce(function (a, x) { return a + (g.shifts[x].t > 0 ? g.shifts[x].d : 0); }, 0);     // completion only counts shifts that had a target
    g.avg = g.shiftCount ? g.done / g.shiftCount : null;
    g.pct = g.target ? g.doneT / g.target : null;
    return g;
  }).sort(function (a, b) { return b.done - a.done; });
  var total = rows.reduce(function (a, g) { return a + g.done; }, 0);
  rows.forEach(function (g) { g.share = total ? g.done / total : null; g.vsAvg = rows.length ? g.done - total / rows.length : 0; });
  var perDayTotals = [0, 0, 0, 0, 0, 0, 0];
  rows.forEach(function (g) { g.perDay.forEach(function (v, i) { perDayTotals[i] += v; }); });
  var shiftsAll = rows.reduce(function (a, g) { return a + g.shiftCount; }, 0), targetAll = rows.reduce(function (a, g) { return a + g.target; }, 0), doneTAll = rows.reduce(function (a, g) { return a + g.doneT; }, 0);
  return { doneT: doneTAll, days: days, dayKeys: dayKeys, rows: rows, total: total, perDayTotals: perDayTotals, shiftsAll: shiftsAll, targetAll: targetAll,
    entriesAll: rows.reduce(function (a, g) { return a + g.entries; }, 0), refDay: refDay, label: days[0] + "  to  " + days[6] };
}

function heat(v, max) {
  if (!max || !v) return "#ffffff";
  var f = Math.min(1, v / max), a = [255, 255, 255], b = [120, 176, 218];
  return "#" + [0, 1, 2].map(function (i) { return ("0" + Math.round(a[i] + (b[i] - a[i]) * f).toString(16)).slice(-2); }).join("");
}

function paintWeekly(sh, wk, label) {
  var n = wk.rows.length, avgText = n ? Math.round(wk.total / n).toLocaleString() : "0";
  titleBand(sh, 11, "Weekly comparison by weigher", "Week " + wk.label + " (Monday to Sunday, week to date through the end of this report)");
  sh.getRange(3, 1).setValue(n ? "Team total " + wk.total.toLocaleString() + " partials across " + n + " weighers. Team average per weigher: " + avgText + ". Ranked by partials weighed." : "No weighing entries this week yet.").setFontColor("#5b6b7a").setFontSize(9);

  var body = wk.rows.map(function (g, i) { return [i + 1, g.name, g.shiftCount, g.entries, g.done, g.avg === null ? "" : g.avg, g.target || "", g.pct === null ? "" : g.pct, g.share === null ? "" : g.share, g.vsAvg]; });
  if (n > 1) body.push(["", "Team", wk.shiftsAll, wk.entriesAll, wk.total, wk.shiftsAll ? wk.total / wk.shiftsAll : "", wk.targetAll || "", wk.targetAll ? wk.doneT / wk.targetAll : "", 1, ""]);
  paintTable(sh, 5, ["Rank", "Weigher", "Shifts worked", "Entries", "Partials weighed", "Average per shift", "Target (all shifts)", "Completion", "Share of team", "Vs team average"],
    body.length ? body : [["", "No entries this week", "", "", "", "", "", "", "", ""]], ["0", null, "0", "0", "#,##0", "#,##0", "#,##0", "0%", "0%", "+#,##0;-#,##0;0"]);
  wk.rows.forEach(function (g, i) {
    var c = pctColor(g.pct); if (c) sh.getRange(6 + i, 8).setBackground(c);
    if (n > 1) sh.getRange(6 + i, 10).setBackground(g.vsAvg >= 0 ? "#e5f4e4" : "#fbebeb");
  });
  if (n > 1) sh.getRange(6 + n, 1, 1, 10).setFontWeight("bold").setBorder(true, null, null, null, null, null, NAVY, SpreadsheetApp.BorderStyle.SOLID);

  var row = 6 + Math.max(body.length, 1) + 2;
  sh.getRange(row, 1).setValue("Partials weighed by day").setFontWeight("bold").setFontSize(12).setFontColor(NAVY);
  var max = 0; wk.rows.forEach(function (g) { g.perDay.forEach(function (v) { if (v > max) max = v; }); });
  var dBody = wk.rows.map(function (g) { return [g.name].concat(g.perDay, [g.done]); });
  if (n > 1) dBody.push(["Team"].concat(wk.perDayTotals, [wk.total]));
  paintTable(sh, row + 1, ["Weigher"].concat(wk.days, ["Week"]), dBody.length ? dBody : [["No entries this week"].concat(["", "", "", "", "", "", "", ""])],
    [null, "#,##0;;\"-\"", "#,##0;;\"-\"", "#,##0;;\"-\"", "#,##0;;\"-\"", "#,##0;;\"-\"", "#,##0;;\"-\"", "#,##0;;\"-\"", "#,##0"]);
  wk.rows.forEach(function (g, i) { g.perDay.forEach(function (v, j) { if (v) sh.getRange(row + 2 + i, 2 + j).setBackground(heat(v, max)); }); });
  if (n > 1) sh.getRange(row + 2 + n, 1, 1, 9).setFontWeight("bold");

  sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 130);
  for (var c = 3; c <= 10; c++) sh.setColumnWidth(c, 105);
  if (n > 1) {
    var chartRow = row + 2 + Math.max(dBody.length, 1) + 1;
    sh.insertChart(sh.newChart().setChartType(Charts.ChartType.COLUMN).addRange(sh.getRange(5, 2, n + 1, 1)).addRange(sh.getRange(5, 5, n + 1, 1))
      .setOption("title", "Partials weighed this week").setOption("legend", { position: "none" }).setOption("colors", [NAVY])
      .setPosition(chartRow, 1, 0, 0).setOption("width", 640).setOption("height", 300).build());
  }
  sh.setFrozenRows(2);
}

// ---- monthly shift comparison: Day vs Evening vs Night, month to date through the end of this report
var SHIFT_NAMES = ["Day", "Evening", "Night"];

function monthlyData(w) {
  var tz = Session.getScriptTimeZone();
  var ref = new Date(w.end.getTime() - 1 - REPORT_HOUR * 3600000);
  var refDay = Utilities.formatDate(ref, tz, "yyyy-MM-dd"), month = refDay.slice(0, 7);
  var rd = ymdParts(refDay), last = new Date(rd.getFullYear(), rd.getMonth() + 1, 0).getDate();
  var parts = [];
  for (var s = 1; s <= last; s += 7) parts.push({ label: "Days " + s + "-" + Math.min(s + 6, last), done: { Day: 0, Evening: 0, Night: 0 } });
  var by = {};
  SHIFT_NAMES.forEach(function (n) { by[n] = { name: n, entries: 0, done: 0, shifts: {} }; });
  rowsOf("entries").forEach(function (r) {
    if (r[E.status] === "removed") return;
    var at = ms(r[E.at]);
    if (at === null || at >= w.end.getTime()) return;
    var date = r[E.date] instanceof Date ? Utilities.formatDate(r[E.date], tz, "yyyy-MM-dd") : String(r[E.date]);
    var g = by[r[E.shift]];
    if (date.slice(0, 7) !== month || !g) return;
    var done = Number(r[E.done]) || 0, target = r[E.target] === "" ? null : Number(r[E.target]);
    g.entries++; g.done += done;
    var key = r[E.pid] + "|" + date;
    var sx = g.shifts[key] = g.shifts[key] || { t: 0, d: 0 };
    sx.t = Math.max(sx.t, target || 0); sx.d += done;
    parts[Math.min(parts.length - 1, Math.floor((Number(date.slice(8)) - 1) / 7))].done[r[E.shift]] += done;
  });
  var rows = SHIFT_NAMES.map(function (n) {
    var g = by[n], keys = Object.keys(g.shifts);
    g.shiftCount = keys.length;
    g.target = keys.reduce(function (a, k) { return a + g.shifts[k].t; }, 0);
    g.doneT = keys.reduce(function (a, k) { return a + (g.shifts[k].t > 0 ? g.shifts[k].d : 0); }, 0);
    g.avg = g.shiftCount ? g.done / g.shiftCount : null;
    g.pct = g.target ? g.doneT / g.target : null;
    return g;
  });
  var total = rows.reduce(function (a, g) { return a + g.done; }, 0);
  rows.forEach(function (g) { g.share = total ? g.done / total : null; });
  var monthName = Utilities.formatDate(ymdParts(refDay), tz, "MMMM yyyy");
  return { doneT: rows.reduce(function (a, g) { return a + g.doneT; }, 0), rows: rows, parts: parts, total: total, month: monthName, through: refDay,
    entries: rows.reduce(function (a, g) { return a + g.entries; }, 0), shiftsAll: rows.reduce(function (a, g) { return a + g.shiftCount; }, 0), targetAll: rows.reduce(function (a, g) { return a + g.target; }, 0) };
}

var SHIFT_COLORS = { Day: "#f2a541", Evening: "#9a8fc9", Night: "#1f6fa8" };

function paintMonthly(sh, m) {
  titleBand(sh, 8, "Monthly shift comparison", m.month + " (month to date, through " + m.through + ")");
  sh.getRange(3, 1).setValue(m.total ? "Partials weighed this month: " + m.total.toLocaleString() + " across " + m.shiftsAll + " person-shifts. Counted by the date each entry was saved for." : "No weighing entries this month yet.").setFontColor("#5b6b7a").setFontSize(9);
  var body = m.rows.map(function (g) { return [g.name, g.entries, g.done, g.shiftCount, g.avg === null ? "" : g.avg, g.target || "", g.pct === null ? "" : g.pct, g.share === null ? "" : g.share]; });
  body.push(["Total", m.entries, m.total, m.shiftsAll, m.shiftsAll ? m.total / m.shiftsAll : "", m.targetAll || "", m.targetAll ? m.doneT / m.targetAll : "", m.total ? 1 : ""]);
  paintTable(sh, 5, ["Shift", "Entries", "Partials weighed", "Person-shifts", "Average per person-shift", "Target", "Completion", "Share of month"], body, [null, "0", "#,##0", "0", "#,##0", "#,##0", "0%", "0%"]);
  m.rows.forEach(function (g, i) { var c = pctColor(g.pct); if (c) sh.getRange(6 + i, 7).setBackground(c); sh.getRange(6 + i, 1).setFontWeight("bold").setFontColor(SHIFT_COLORS[g.name]); });
  sh.getRange(9, 1, 1, 8).setFontWeight("bold");

  sh.getRange(11, 1).setValue("Partials weighed through the month").setFontWeight("bold").setFontSize(12).setFontColor(NAVY);
  var pBody = m.parts.map(function (p) { return [p.label, p.done.Day, p.done.Evening, p.done.Night, p.done.Day + p.done.Evening + p.done.Night]; });
  paintTable(sh, 12, ["Period", "Day", "Evening", "Night", "All shifts"], pBody, [null, "#,##0;;\"-\"", "#,##0;;\"-\"", "#,##0;;\"-\"", "#,##0;;\"-\""]);
  sh.setColumnWidth(1, 150); for (var c = 2; c <= 8; c++) sh.setColumnWidth(c, 125);

  var chartRow = 12 + pBody.length + 3;
  sh.insertChart(sh.newChart().setChartType(Charts.ChartType.COLUMN).addRange(sh.getRange(5, 1, 4, 1)).addRange(sh.getRange(5, 3, 4, 1))
    .setOption("title", "Month total by shift").setOption("legend", { position: "none" }).setOption("colors", [NAVY])
    .setPosition(chartRow, 1, 0, 0).setOption("width", 420).setOption("height", 300).build());
  sh.insertChart(sh.newChart().setChartType(Charts.ChartType.COLUMN).addRange(sh.getRange(12, 1, pBody.length + 1, 4))
    .setOption("title", "Day vs Evening vs Night through the month").setOption("legend", { position: "bottom" }).setOption("colors", [SHIFT_COLORS.Day, SHIFT_COLORS.Evening, SHIFT_COLORS.Night])
    .setPosition(chartRow, 4, 20, 0).setOption("width", 560).setOption("height", 300).build());
  sh.setFrozenRows(2);
}

function buildReportBook(w, d) {
  var tz = Session.getScriptTimeZone(), label = Utilities.formatDate(w.start, tz, "EEE d MMM yyyy h:mm a") + "  to  " + Utilities.formatDate(w.end, tz, "EEE d MMM yyyy h:mm a");
  var ss = SpreadsheetApp.create("Partials Tracker Daily Report " + Utilities.formatDate(w.end, tz, "yyyy-MM-dd"));
  ss.setSpreadsheetTimeZone(tz);
  var sum = ss.getSheets()[0]; sum.setName("Summary"); sum.setHiddenGridlines(true);
  var wk = ss.insertSheet("Weekly comparison"), mo = ss.insertSheet("Monthly shifts"), wt = ss.insertSheet("Weighed"), rq = ss.insertSheet("Material requests"), sg = ss.insertSheet("Sign-ins");
  [wk, mo, wt, rq, sg].forEach(function (s) { s.setHiddenGridlines(true); });

  // ---- Summary: title, six tiles, then the two tables
  titleBand(sum, 6, "Partials Tracker  |  Daily Report", label);
  var tiles = [["Partials weighed", d.totalDone, "#,##0"], ["Weighing entries", d.entries.length, "0"], ["Material requests", d.reqs.length, "0"],
    ["Average wait", d.avgWait === null ? "none" : sec2clock(d.avgWait), "@"], ["Longest wait", d.maxWait === null ? "none" : sec2clock(d.maxWait), "@"], ["Sign-ins", d.signedIn, "0"]];
  tiles.forEach(function (t, i) {
    sum.getRange(4, i + 1).setValue(t[0]).setFontColor("#5b6b7a").setFontSize(9).setHorizontalAlignment("center").setBackground(PALE);
    sum.getRange(5, i + 1).setNumberFormat(t[2]).setValue(t[1]).setFontSize(22).setFontWeight("bold").setFontColor(NAVY).setHorizontalAlignment("center").setBackground(PALE);
    sum.getRange(4, i + 1, 2, 1).setBorder(true, true, true, true, false, false, GRID, SpreadsheetApp.BorderStyle.SOLID);
  });
  sum.setRowHeight(5, 44);
  sum.getRange(6, 1).setValue("Delivered " + d.delivered + "  |  Cancelled " + d.cancelled + "  |  Still waiting " + d.stillOpen + "  |  Weighing entries removed " + d.removed + "  |  Failed sign-ins " + d.failedIn).setFontColor("#5b6b7a").setFontSize(9);

  var row = 8;
  sum.getRange(row, 1).setValue("Weighers").setFontWeight("bold").setFontSize(12).setFontColor(NAVY);
  var wBody = d.weighers.map(function (g) { return [g.name, g.entries, g.done, g.target === null ? "" : g.target, g.pct === null ? "" : g.pct]; });
  paintTable(sum, row + 1, ["Weigher", "Entries", "Partials weighed", "Target", "Completion"], wBody.length ? wBody : [["No entries in this period", "", "", "", ""]], [null, "0", "#,##0", "#,##0", "0%"]);
  d.weighers.forEach(function (g, i) { var c = pctColor(g.pct); if (c) sum.getRange(row + 2 + i, 5).setBackground(c); });
  var chartRows = d.weighers.length;
  row = row + 2 + Math.max(wBody.length, 1) + 1;

  sum.getRange(row, 1).setValue("Pullers").setFontWeight("bold").setFontSize(12).setFontColor(NAVY);
  var pBody = d.pullers.map(function (g) { return [g.name, g.count, sec2clock(g.avg), sec2clock(g.max)]; });
  paintTable(sum, row + 1, ["Puller", "Deliveries", "Average wait (m:ss)", "Longest wait (m:ss)"], pBody.length ? pBody : [["No deliveries in this period", "", "", ""]], [null, "0", "@", "@"]);
  sum.setColumnWidth(1, 190);
  for (var c = 2; c <= 6; c++) sum.setColumnWidth(c, 130);
  if (chartRows > 1) {
    sum.insertChart(sum.newChart().setChartType(Charts.ChartType.COLUMN).addRange(sum.getRange(9, 1, chartRows + 1, 1)).addRange(sum.getRange(9, 3, chartRows + 1, 1))
      .setOption("title", "Partials weighed by weigher").setOption("legend", { position: "none" }).setOption("colors", [NAVY])
      .setPosition(row + 4 + Math.max(pBody.length, 1), 1, 0, 0).setOption("width", 640).setOption("height", 280).build());
  }
  sum.setFrozenRows(2);

  // ---- Weighed
  titleBand(wt, 9, "Partials weighed", label);
  paintTable(wt, 4, ["Saved at", "Weigher", "Name entered", "For date", "Shift", "Partials weighed", "Partials in batch", "Target", "Completion"],
    d.entries.map(function (e) { return [new Date(e.at), e.name, e.typed, e.date, e.shift, e.done, e.book === null ? "" : e.book, e.target === null ? "" : e.target, e.target ? e.done / e.target : ""]; }),
    ["yyyy-mm-dd hh:mm", null, null, "@", null, "#,##0", "#,##0", "#,##0", "0%"]);
  d.entries.forEach(function (e, i) { var c = pctColor(e.target ? e.done / e.target : null); if (c) wt.getRange(5 + i, 9).setBackground(c); });
  [150, 150, 150, 100, 80, 120, 120, 90, 100].forEach(function (x, i) { wt.setColumnWidth(i + 1, x); });
  wt.setFrozenRows(4);

  // ---- Material requests
  titleBand(rq, 7, "Material requests", label);
  paintTable(rq, 4, ["Requested at", "Weigher", "Materials requested", "Status", "Delivered at", "Delivered by", "Wait (h:mm:ss)"],
    d.reqs.map(function (q) { return [new Date(q.at), q.name, q.item, q.status, q.done ? new Date(q.done) : "", q.by, q.wait === null ? "" : q.wait / 86400]; }),
    ["yyyy-mm-dd hh:mm", null, null, null, "yyyy-mm-dd hh:mm", null, "[h]:mm:ss"]);
  rq.getRange(5, 3, Math.max(d.reqs.length, 1), 1).setWrap(true);
  [150, 150, 380, 90, 150, 150, 110].forEach(function (x, i) { rq.setColumnWidth(i + 1, x); });
  rq.setFrozenRows(4);

  // ---- Sign-ins
  titleBand(sg, 3, "Sign-ins", label);
  paintTable(sg, 4, ["Time", "ID", "Result"], d.logins.map(function (l) { return [new Date(l.at), l.id, l.result]; }), ["yyyy-mm-dd hh:mm:ss", null, null]);
  d.logins.forEach(function (l, i) { if (l.result !== "signed in") sg.getRange(5 + i, 3).setBackground("#fbebeb"); });
  [160, 120, 140].forEach(function (x, i) { sg.setColumnWidth(i + 1, x); });
  sg.setFrozenRows(4);
  paintWeekly(wk, weeklyData(w), label);
  paintMonthly(mo, monthlyData(w));
  SpreadsheetApp.flush();
  return { ss: ss, label: label };
}

// builds the workbook for any period, emails it to TO and returns the totals
function emailReport(w, who) {
  var d = reportData(w), tz = Session.getScriptTimeZone();
  var built = buildReportBook(w, d);
  var file = DriveApp.getFileById(built.ss.getId());
  var stamp = Utilities.formatDate(w.start, tz, "yyyy-MM-dd HHmm") + " to " + Utilities.formatDate(w.end, tz, "yyyy-MM-dd HHmm");
  var res = UrlFetchApp.fetch("https://docs.google.com/spreadsheets/d/" + built.ss.getId() + "/export?format=xlsx", { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { file.setTrashed(true); throw new Error("Excel export failed (" + res.getResponseCode() + ")"); }
  var xlsx = res.getBlob().setName("Partials Tracker Report " + stamp + ".xlsx");
  var lines = ["Partials Tracker report", built.label, "Sent by " + who, "",
    "Partials weighed: " + d.totalDone + " in " + d.entries.length + " entries",
    "Material requests: " + d.reqs.length + " (delivered " + d.delivered + ", cancelled " + d.cancelled + ", still waiting " + d.stillOpen + ")",
    "Average wait: " + (d.avgWait === null ? "none" : sec2clock(d.avgWait)) + "   Longest wait: " + (d.maxWait === null ? "none" : sec2clock(d.maxWait)),
    "Sign-ins: " + d.signedIn + ", failed attempts: " + d.failedIn, "",
    "The full workbook is attached (Summary, Weekly comparison, Monthly shifts, Weighed, Material requests, Sign-ins)."];
  MailApp.sendEmail({ to: TO, subject: "[Partials Tracker] Report " + Utilities.formatDate(w.start, tz, "MMM d h:mm a") + " to " + Utilities.formatDate(w.end, tz, "MMM d h:mm a"), body: lines.join("\n"), attachments: [xlsx], name: "Partials Tracker" });
  file.setTrashed(true);
  return d;
}

// the Send report button (supervisors only); the supervisor chooses the period
function sendReport(d, s) {
  var from = Number(d.from), to = Number(d.to), now = Date.now();
  if (!isFinite(from) || !isFinite(to) || to <= from || to - from > 7 * 86400000 || to > now + 120000 || from < now - 90 * 86400000) return { ok: false, error: "range" };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties(), day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    var st = JSON.parse(props.getProperty("reports") || "{}");
    if (st.day !== day) { st.day = day; st.count = 0; }
    if (st.count >= MAX_REPORTS_PER_DAY) return { ok: false, error: "limit" };
    st.count++;
    props.setProperty("reports", JSON.stringify(st));
  } finally {
    lock.releaseLock();
  }
  var r = emailReport({ start: new Date(from), end: new Date(Math.min(to, now)) }, s.name + " (" + s.id + ")");
  return { ok: true, weighed: r.totalDone, entries: r.entries.length, requests: r.reqs.length };
}

// run from the editor to send a test copy of the last finished 6-to-6 period
function testReport() {
  emailReport(reportWindow(new Date()), "the script editor");
  Logger.log("Report sent to " + TO);
}
