/**
 * Headless behaviour tests for the pill renderer (status.html).
 *
 * Run: npm run test:pill
 *
 * These cover the flows that have no other safety net: toast survival across a
 * status refresh, the compose/send path, the contradiction accept/decline
 * colouring, the green "saved" flash, and double-tap safety on decide.
 */
const path = require("path");
const { app, BrowserWindow } = require("electron");

const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  process.stdout.write(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? ` — ${detail}` : ""}\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(win, script) {
  return win.webContents.executeJavaScript(`(async () => { ${script} })()`, true);
}

async function main() {
  const win = new BrowserWindow({
    width: 520,
    height: 200,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "pill-stub-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(__dirname, "..", "status.html"));
  await sleep(300);

  // 1. Boots into the actions bank with no Speak tab left behind.
  check(
    "boots into the Do bank",
    await run(win, `return document.querySelector('#banks button.on')?.dataset.bank === 'actions';`)
  );
  check(
    "speak tab is gone",
    await run(
      win,
      `return ![...document.querySelectorAll('#banks button')].some((b) => /speak/i.test(b.textContent));`
    )
  );

  // 2. A toast survives a status refresh — the regression that silently ate
  //    every "Saved" confirmation.
  await run(
    win,
    `window.__harness.emit('toast', { kicker: 'Saved', title: 'Wrote to Notes', ms: 5000 });`
  );
  check(
    "toast renders full title",
    await run(
      win,
      `return document.getElementById('toast').classList.contains('on')
        && document.getElementById('toastTitle').textContent === 'Wrote to Notes';`
    )
  );
  await run(win, `window.__harness.emit('status', { at: Date.now() });`);
  await sleep(250);
  check(
    "toast survives a status refresh",
    await run(win, `return document.getElementById('toast').classList.contains('on');`)
  );

  // 3. Toast clears itself.
  await run(win, `window.__harness.emit('toast', { title: 'Quick', ms: 150 });`);
  await sleep(400);
  check(
    "toast auto-dismisses",
    await run(win, `return !document.getElementById('toast').classList.contains('on');`)
  );

  // 4. Compose (typed capture) replaces the old voice/mic bank.
  await run(
    win,
    `window.__harness.clearCalls();
     window.__harness.emit('pill', { view: 'compose', draft: { text: 'lunch with sam tomorrow' } });`
  );
  await sleep(150);
  check(
    "compose view shows the draft text",
    await run(win, `return document.getElementById('composeText').value === 'lunch with sam tomorrow';`)
  );
  await run(win, `document.getElementById('dialBtn').click();`);
  await sleep(200);
  check(
    "dial sends the typed capture",
    await run(
      win,
      `const c = window.__harness.calls().find((c) => c.name === 'composerSend');
       return !!c && c.args[0] === 'lunch with sam tomorrow';`
    )
  );

  // 5. Discard clears the draft and tells main to drop it.
  await run(
    win,
    `window.__harness.clearCalls();
     window.__harness.emit('pill', { view: 'compose', draft: { text: 'scratch note' } });`
  );
  await sleep(150);
  await run(win, `document.getElementById('composeCancel').click();`);
  await sleep(120);
  check(
    "discard clears the textarea and calls composerCancel",
    await run(
      win,
      `return document.getElementById('composeText').value === ''
        && window.__harness.calls().some((c) => c.name === 'composerCancel');`
    )
  );

  // 6. Decide / save flow for an ordinary capture.
  await run(
    win,
    `window.__harness.clearCalls();
     window.__harness.emit('pill', {
       view: 'decide',
       item: {
         id: 'perm-1',
         title: 'Lunch with Sam',
         primaryDestination: 'calendar',
         queueIndex: 0,
         queueTotal: 2,
         actionOptions: [
           { destination: 'calendar', label: 'Calendar' },
           { destination: 'notes', label: 'Notes' }
         ]
       }
     });`
  );
  await sleep(200);
  check(
    "decide view selects the inferred destination and shows tick/cross circles",
    await run(
      win,
      `return document.querySelector('#banks button.on')?.dataset.bank === 'decide'
        && document.getElementById('dialDecide').classList.contains('on')
        && document.getElementById('dialDefault').classList.contains('hide')
        && document.getElementById('decideHint').textContent === '1/2';`
    )
  );
  await run(win, `document.getElementById('acceptCircle').click();`);
  await sleep(250);
  check(
    "tick circle resolves with accept + the highlighted destination",
    await run(
      win,
      `const c = window.__harness.calls().find((c) => c.name === 'resolve');
       return !!c && c.args[0] === 'perm-1' && c.args[1] === true && c.args[3] === 'calendar';`
    )
  );

  // 7. The green saved-flash plays on every accepted save.
  await run(win, `window.__harness.emit('saved', { title: 'Lunch with Sam', body: 'Saved to Calendar' });`);
  await sleep(80);
  check(
    "saved flash turns on with the right copy",
    await run(
      win,
      `return document.getElementById('savedFlash').classList.contains('on')
        && document.getElementById('savedTitle').textContent === 'Lunch with Sam'
        && document.getElementById('savedBody').textContent === 'Saved to Calendar';`
    )
  );
  await sleep(1700);
  check(
    "saved flash clears itself",
    await run(win, `return !document.getElementById('savedFlash').classList.contains('on');`)
  );

  // 8. Contradictions get the same tick (accept) / cross (decline) circles —
  //    this is the smart-inference UI, with the old/new values shown as context
  //    above the list instead of a destination picker.
  await run(
    win,
    `window.__harness.clearCalls();
     window.__harness.emit('pill', {
       view: 'decide',
       item: {
         id: 'perm-3',
         kind: 'contradiction',
         title: 'Your notes disagree — fix?',
         payload: { existing: 'allergic to nickel', incoming: 'not allergic' },
       }
     });`
  );
  await sleep(200);
  check(
    "contradiction shows the existing → incoming context",
    await run(
      win,
      `return document.getElementById('context').textContent.includes('allergic to nickel')
        && document.getElementById('context').textContent.includes('not allergic');`
    )
  );
  check(
    "contradiction shows tick/cross circles, not a destination list",
    await run(
      win,
      `return document.getElementById('dialDecide').classList.contains('on')
        && document.getElementById('acceptCircle').offsetParent !== null
        && document.getElementById('declineCircle').offsetParent !== null;`
    )
  );
  await run(win, `document.getElementById('declineCircle').click();`);
  await sleep(200);
  check(
    "cross circle declines a contradiction as facts-only with accept=false",
    await run(
      win,
      `const c = window.__harness.calls().find((c) => c.name === 'resolve');
       return !!c && c.args[0] === 'perm-3' && c.args[1] === false && c.args[2] === 'facts-only';`
    )
  );

  await run(
    win,
    `window.__harness.clearCalls();
     window.__harness.emit('pill', {
       view: 'decide',
       item: {
         id: 'perm-4',
         kind: 'contradiction',
         title: 'Your notes disagree — fix?',
         payload: { existing: 'budget $50', incoming: 'budget $95' },
       }
     });`
  );
  await sleep(200);
  await run(win, `document.getElementById('acceptCircle').click();`);
  await sleep(200);
  check(
    "tick circle accepts a contradiction to notes regardless of the internal key",
    await run(
      win,
      `const c = window.__harness.calls().find((c) => c.name === 'resolve');
       return !!c && c.args[0] === 'perm-4' && c.args[1] === true && c.args[3] === 'notes';`
    )
  );

  // 9. Core offline is actionable from the Fix bank.
  await run(
    win,
    `window.__harness.setStatus({ coreOk: false, pendingCount: 0 });
     window.__harness.emit('pill', { view: 'fix' });`
  );
  await sleep(250);
  check(
    "fix bank surfaces core offline",
    await run(
      win,
      `return [...document.querySelectorAll('#list button')]
        .some((b) => b.textContent.includes('Core offline'));`
    )
  );

  // 10. Never resolve the same item twice on a double tap.
  await run(
    win,
    `window.__harness.setStatus({ coreOk: true });
     window.__harness.clearCalls();
     window.__harness.emit('pill', {
       view: 'decide',
       item: { id: 'perm-2', title: 'Note', primaryDestination: 'notes',
               actionOptions: [{ destination: 'notes', label: 'Notes' }] }
     });`
  );
  await sleep(200);
  await run(
    win,
    `document.getElementById('acceptCircle').click();
     document.getElementById('acceptCircle').click();`
  );
  await sleep(300);
  check(
    "double tap resolves once",
    await run(
      win,
      `return window.__harness.calls().filter((c) => c.name === 'resolve').length === 1;`
    ),
    await run(
      win,
      `return String(window.__harness.calls().filter((c) => c.name === 'resolve').length);`
    )
  );

  // 11. Regression: tapping a pref row must be the only thing that flips it —
  //     the dial used to *also* toggle the selected pref, so tapping a row
  //     then tapping the dial (which felt like "confirming") silently flipped
  //     it straight back off.
  await run(
    win,
    `window.__harness.setStatus({ prefs: { confirmCapture: false, openAtLogin: false, showDock: false, quietHours: false } });
     window.__harness.clearCalls();
     window.__harness.emit('pill', { view: 'prefs' });`
  );
  await sleep(200);
  await run(win, `[...document.querySelectorAll('#list button')][0].click();`);
  await sleep(200);
  check(
    "tapping a pref row flips it on and shows the switch on",
    await run(
      win,
      `const c = window.__harness.calls().find((c) => c.name === 'setPref');
       return !!c && c.args[0] === 'confirmCapture' && c.args[1] === true
         && document.querySelector('#list button .switch.on') != null;`
    )
  );
  await run(win, `window.__harness.clearCalls(); document.getElementById('dialBtn').click();`);
  await sleep(200);
  check(
    "the dial does not also toggle it back off",
    await run(win, `return !window.__harness.calls().some((c) => c.name === 'setPref');`)
  );

  // 12. Accessibility missing surfaces first in Fix and the toast CTA opens Settings.
  await run(
    win,
    `window.__harness.setStatus({
       coreOk: true,
       permissions: { accessibility: 'needs_action', notifications: 'available' },
       writebackRetries: [],
       failedHotkeys: [],
     });
     window.__harness.clearCalls();
     window.__harness.emit('pill', { view: 'fix' });`
  );
  await sleep(200);
  check(
    "fix bank lists Allow Accessibility first",
    await run(
      win,
      `const first = document.querySelector('#list button');
       return first && first.textContent.includes('Allow Accessibility');`
    )
  );
  await run(win, `document.querySelector('#list button').click();`);
  await sleep(150);
  check(
    "Allow Accessibility opens the Settings deep link",
    await run(
      win,
      `return window.__harness.calls().some((c) => c.name === 'openAccessibility');`
    )
  );
  await run(
    win,
    `window.__harness.clearCalls();
     window.__harness.emit('toast', {
       kicker: 'Capture tip',
       title: 'macOS still blocks reading apps',
       ms: 8000,
       fix: { label: 'Open Settings', action: 'open-accessibility' },
       fixSecondary: { label: 'Continue', action: 'dismiss-accessibility' },
     });`
  );
  await sleep(100);
  await run(win, `document.getElementById('toastFix').click();`);
  await sleep(120);
  check(
    "toast Open Settings button calls openAccessibility",
    await run(
      win,
      `return window.__harness.calls().some((c) => c.name === 'openAccessibility');`
    )
  );
  await run(
    win,
    `window.__harness.clearCalls();
     window.__harness.emit('toast', {
       title: 'macOS still blocks',
       ms: 8000,
       fix: { label: 'Open Settings', action: 'open-accessibility' },
       fixSecondary: { label: 'Continue', action: 'dismiss-accessibility' },
     });`
  );
  await sleep(80);
  await run(win, `document.getElementById('toastFixSecondary').click();`);
  await sleep(120);
  check(
    "toast Continue dismisses the accessibility nag",
    await run(
      win,
      `return window.__harness.calls().some((c) => c.name === 'dismissAccessibility');`
    )
  );

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(
    `\n${results.length - failed.length}/${results.length} pill checks passed\n`
  );
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() =>
  main().catch((e) => {
    process.stdout.write(`HARNESS ERROR ${e && e.stack ? e.stack : e}\n`);
    app.exit(1);
  })
);
