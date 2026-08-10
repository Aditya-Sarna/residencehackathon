const hud = document.getElementById("hud");
const kicker = document.getElementById("kicker");
const title = document.getElementById("title");
const body = document.getElementById("body");
const meta = document.getElementById("meta");

function show(payload) {
  kicker.textContent = payload.kicker || "Captured";
  title.textContent = payload.title || "Reading context…";
  body.textContent = payload.body || "";
  meta.innerHTML = [
    payload.app || "Mac",
    payload.method || "capture",
    payload.queued != null ? `${payload.queued} queued` : null,
  ]
    .filter(Boolean)
    .map((x) => String(x).replace(/-/g, " "))
    .join("<br/>");
  hud.classList.remove("out");
  // restart CSS animation
  void hud.offsetWidth;
  hud.classList.add("on");
}

function hide() {
  hud.classList.add("out");
  hud.classList.remove("on");
}

window.residence.onHud((payload) => {
  if (!payload || payload.hide) {
    hide();
    return;
  }
  show(payload);
});
