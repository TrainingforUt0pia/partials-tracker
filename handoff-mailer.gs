// Shift Handoff mailer for Partials Tracker. Paste this into a Google Apps Script project
// signed in as the mailbox that should send the emails, then deploy it as a web app.
// Put the real supervisor addresses in TO inside Apps Script only. Do not commit them to the repo.

var TO = "supervisor1@example.com,supervisor2@example.com";
var MAX_PER_HOUR = 20;      // stops anyone flooding the supervisors
var MAX_SUBJECT = 150;
var MAX_MESSAGE = 8000;

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var subject = String(data.subject || "").trim().slice(0, MAX_SUBJECT);
    var message = String(data.message || "").trim().slice(0, MAX_MESSAGE);
    if (!subject || !message) return reply({ ok: false, error: "empty" });

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var cache = CacheService.getScriptCache();
      var sent = Number(cache.get("sent") || 0);
      if (sent >= MAX_PER_HOUR) return reply({ ok: false, error: "limit" });
      cache.put("sent", String(sent + 1), 3600);
    } finally {
      lock.releaseLock();
    }

    MailApp.sendEmail({ to: TO, subject: "[Partials Tracker] " + subject, body: message, name: "Partials Tracker" });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: "failed" });
  }
}

function doGet() {
  return reply({ ok: true, info: "Partials Tracker handoff mailer is running." });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
