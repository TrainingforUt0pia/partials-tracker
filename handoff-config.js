// Shift Handoff mailer: the web app URL of the Google Apps Script in handoff-mailer.gs (not a secret).
// Supervisor addresses live inside that script, never in this repo.
// While scriptUrl is empty, handoffs are saved on the phone but not emailed.
window.HANDOFF_CONFIG = {
  scriptUrl: "https://script.google.com/macros/s/AKfycbwIPeQsRiudzDi39BzBkMxs2F9dIWSlZk20-EAu4Banu8FkabEU0qa1upeG6mlmebedig/exec"
};
