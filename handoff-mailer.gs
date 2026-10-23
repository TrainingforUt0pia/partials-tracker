// Shift Handoff mailer for Partials Tracker. Paste this into a Google Apps Script project
// signed in as the mailbox that should send the emails, then deploy it as a web app.
// Put the real supervisor addresses in TO inside Apps Script only. Do not commit them to the repo.
//
// Safety checks: handoff format only, no links or email addresses, hourly and daily caps,
// and a footer that tells supervisors what a real handoff looks like.

var TO = "supervisor1@example.com,supervisor2@example.com";
var MAX_PER_HOUR = 10;
var MAX_PER_DAY = 40;
var MAX_SUBJECT = 150;
var MAX_MESSAGE = 6000;

// links, web addresses, mailto: and email addresses (the app strips these before sending, so real handoffs never trip this)
var LINK = /(https?:\/\/|ftp:\/\/|mailto:|www\.)|[\w.+-]+@[\w-]+\.[a-z]{2,}|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|co|us|ly|me|xyz|ru|info|biz|app|dev|link|site|online|top|click|cc|tk)\b/i;

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var subject = String(data.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, MAX_SUBJECT);
    var message = String(data.message || "").trim().slice(0, MAX_MESSAGE);

    if (!subject || !message) return reply({ ok: false, error: "empty" });
    if (subject.indexOf("Shift Handoff:") !== 0 || message.indexOf("Shift Handoff\nWeigher: ") !== 0 || message.indexOf("\nNotes:\n") < 0) {
      return reply({ ok: false, error: "format" });
    }
    if (LINK.test(subject) || LINK.test(message)) return reply({ ok: false, error: "link" });

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var props = PropertiesService.getScriptProperties();
      var now = Date.now(), day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
      var st = JSON.parse(props.getProperty("rate") || "{}");
      if (!st.hourStart || now - st.hourStart > 3600000) { st.hourStart = now; st.hourCount = 0; }
      if (st.day !== day) { st.day = day; st.dayCount = 0; }
      if (st.hourCount >= MAX_PER_HOUR || st.dayCount >= MAX_PER_DAY) return reply({ ok: false, error: "limit" });
      st.hourCount++; st.dayCount++;
      props.setProperty("rate", JSON.stringify(st));
    } finally {
      lock.releaseLock();
    }

    var footer = "\n\n---\nSent by the Partials Tracker app. Real handoffs never contain links or email addresses. If this one does, or looks wrong, do not trust it.";
    MailApp.sendEmail({ to: TO, subject: "[Partials Tracker] " + subject, body: message + footer, name: "Partials Tracker" });
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
