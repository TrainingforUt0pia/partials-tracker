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

var TABS = {
  requests: { name: "Requests", dateCols: ["B", "G"], headers: ["id", "requestedAt", "personId", "name", "item", "status", "deliveredAt", "deliveredById", "deliveredBy", "waitSeconds", "device"] },
  people:   { name: "People", dateCols: ["F", "H", "J"], headers: ["personId", "name", "role", "pinHash", "status", "createdAt", "createdBy", "lastSignIn", "ackVersion", "ackAt"] },
  acks:     { name: "Acknowledgments", dateCols: ["B"], headers: ["ackId", "signedAt", "personId", "registeredName", "typedName", "nameMatches", "role", "letterVersion", "letterHash", "device", "signatureFile", "method"] },
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
  tab("requests"); tab("people"); tab("acks"); tab("signins");
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
  if (a === "signins") return can(s, ADMIN) ? recentSignins() : { ok: false, error: "role" };
  var need = { request: WEIGHER, cancel: WEIGHER, handoff: WEIGHER, deliver: PULLER, addPerson: ADMIN, resetPin: ADMIN, setStatus: ADMIN };
  if (!need[a]) return { ok: false, error: "action" };
  if (!can(s, need[a])) return { ok: false, error: "role" };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (a === "request") return addRequest(d, s);
    if (a === "cancel") return cancelRequest(d, s);
    if (a === "deliver") return deliver(d, s);
    if (a === "handoff") return handoff(d, s);
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
  sh.appendRow([id, new Date(now), s.id, s.name, clean(d.item, 160), "open", "", "", "", "", validDevice(d.device) ? d.device : ""]);
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
  var start = Math.max(2, n - 59);
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
