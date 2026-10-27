// The web app URL of the Google Apps Script in google-script.gs (not a secret).
// It sends the Shift Handoff email and stores the material requests in a Google Sheet.
// Supervisor addresses and the puller PIN live inside that script, never in this repo.
// While scriptUrl is empty, handoffs are saved on the phone but not emailed, and requests are switched off.
window.HANDOFF_CONFIG = {
  scriptUrl: "https://script.google.com/macros/s/AKfycbwIPeQsRiudzDi39BzBkMxs2F9dIWSlZk20-EAu4Banu8FkabEU0qa1upeG6mlmebedig/exec"
};
