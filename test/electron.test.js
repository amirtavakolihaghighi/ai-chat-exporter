/**
 * Electron-side tests: runs the real injected extractor against DOM fixtures
 * that reproduce the failure modes worth caring about (virtualised message
 * lists, collapsed reasoning, clamped text, unrecognised markup), then
 * exercises the PDF and screenshot capture paths and boots the real UI.
 *
 *   npm run test:electron
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const { COMMON_STRIP, COMMON_EXPAND } = require('../src/shared/providers');
const siteRules = require('../src/shared/rules');
const capture = require('../src/main/lib/capture');
const inject = require('../src/main/lib/inject');
const convert = require('../src/main/lib/convert');
const { renderHtml } = require('../src/main/lib/render');

// Electron builds for Windows are GUI-subsystem binaries and have no console
// attached, so results are written to a file the runner prints afterwards.
const REPORT = path.join(__dirname, 'results.txt');
const lines = [];
let failures = 0;
try {
  fs.unlinkSync(REPORT);
} catch {
  /* no previous report */
}

// Flushed line by line: if a check wedges the run, the report still shows
// exactly how far it got.
function say(line) {
  lines.push(line);
  console.log(line);
  try {
    fs.appendFileSync(REPORT, line + '\n', 'utf8');
  } catch {
    /* reporting must never break the run */
  }
}

function check(name, cond, extra = '') {
  if (!cond) failures++;
  say(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

/** A built-in rule set, compiled exactly as the apps compile it. */
function builtin(id) {
  return siteRules.compile(siteRules.builtinById(id), 'https://example.test/');
}

/** A rule set made of the given parts, as if taught on a site. */
function taught(parts, options = {}) {
  return { id: 'u-test', origin: 'user', name: 'Taught', providerId: 'custom', parts, options };
}

function buildSource(rules, extra = {}) {
  return inject.buildExtractorSource({
    rules: rules || null,
    commonStrip: COMMON_STRIP,
    commonExpand: COMMON_EXPAND,
    embedImages: true,
    debug: true,
    settleMs: 120,
    maxScrollSteps: 400,
    maxImageBytes: 12 * 1024 * 1024,
    maxTotalImageBytes: 150 * 1024 * 1024,
    ...extra,
  });
}

// One window is reused for every fixture. Creating and tearing down a window
// per fixture proved unstable on this machine's GPU stack.
let fixtureWin = null;
function getFixtureWindow() {
  if (fixtureWin && !fixtureWin.isDestroyed()) return fixtureWin;
  fixtureWin = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Matches the real webview: without this, a hidden window throttles the
      // fixture's scroll listener and the virtualiser lags behind the harvester.
      backgroundThrottling: false,
    },
  });
  fixtureWin.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/Security Warning/.test(message)) say(`    [page console] ${message}`);
  });
  return fixtureWin;
}

/* ---------------------------------------------------- the teach overlay */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens the teach overlay; the promise settles when it is saved or closed. */
async function startTeach(options) {
  const { PARTS } = require('../src/shared/parts');
  const source = await inject.buildTeachSource({ parts: PARTS, ...options });
  const settled = getFixtureWindow().webContents.executeJavaScript(source, true);
  await sleep(500);
  return settled;
}

/** Runs code against the overlay's shadow root. */
function overlay(body) {
  return getFixtureWindow().webContents.executeJavaScript(`(() => {
    const root = document.getElementById('__ace_teach__')?.shadowRoot;
    if (!root) return null;
    const press = (label) => {
      const b = Array.from(root.querySelectorAll('button')).find((x) => x.textContent.includes(label));
      if (b) b.click();
      return Boolean(b);
    };
    ${body}
  })()`, true);
}

/** Clicks an element the way a person would: pointer events, then a click. */
async function clickOnPage(selector) {
  await getFixtureWindow().webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 24);
    const hit = document.elementFromPoint(x, y);
    for (const type of ['pointermove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      hit.dispatchEvent(new Ctor(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, button: 0 }));
    }
  })()`, true);
  await sleep(250);
}

async function loadFixture(fixture) {
  await getFixtureWindow().loadFile(path.join(__dirname, 'fixtures', fixture));
  await sleep(300);
}

async function runExtractor(fixture, rules, extra, prepare) {
  const win = getFixtureWindow();
  await win.loadFile(path.join(__dirname, 'fixtures', fixture));
  await new Promise((r) => setTimeout(r, 300));
  if (prepare) await win.webContents.executeJavaScript(`(() => { ${prepare}; return true; })()`);

  // executeJavaScript reports any throw as a generic "Script failed to execute",
  // so wrap the injection to surface the actual stack.
  const body = (await buildSource(rules, extra)).trim().replace(/;\s*$/, '');
  const wrapped = `(async () => { try { return await (${body}); } catch (e) { return { ok:false, error: String((e && e.stack) || e) }; } })()`;
  let result;
  try {
    result = await win.webContents.executeJavaScript(wrapped, true);
  } catch (err) {
    result = { ok: false, error: `executeJavaScript rejected: ${err.message}` };
  }
  return result;
}

// Headless CI-ish runs on flaky GPU drivers crash during window churn.
app.disableHardwareAcceleration();

// Without a listener here, Electron quits the moment the last test window is
// destroyed — which would abort the run before the capture checks and before
// the report is written.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const outDir = path.join(app.getPath('temp'), 'ace-test-output');
  fs.mkdirSync(outDir, { recursive: true });

  try {
    /* --------------- fixture 1: ChatGPT-shaped, rule-driven -------------- */
    const chatgpt = builtin('chatgpt');
    const r1 = await runExtractor('fixture-chatgpt.html', chatgpt);

    check('chatgpt: extraction succeeded', r1.ok === true, r1.error || '');
    check('chatgpt: 6 messages', r1.messages.length === 6, `got ${r1.messages.length}`);
    check('chatgpt: roles alternate correctly',
      r1.messages.map((m) => m.role).join(',') === 'user,assistant,user,assistant,user,assistant',
      r1.messages.map((m) => m.role).join(','));
    check('chatgpt: document order preserved',
      r1.messages[0].text.includes('What is quicksort') && r1.messages[5].text.includes('You are welcome'));
    check('chatgpt: provider suffix trimmed from title', r1.title === 'Sorting algorithms', r1.title);
    check('chatgpt: UI buttons stripped from content',
      !r1.messages.some((m) => /Regenerate|Copy/.test(m.text)));
    check('chatgpt: svg stripped', !r1.messages.some((m) => m.html.includes('<svg')));
    check('chatgpt: code block kept with its language',
      r1.messages[1].html.includes('language-python') && r1.messages[1].html.includes('def qs'));
    check('chatgpt: collapsed <details> reasoning expanded and captured',
      r1.messages[1].thinkingHtml.includes('partitioning first'), r1.messages[1].thinkingHtml.slice(0, 80));
    check('chatgpt: reasoning kept out of the message body',
      !r1.messages[1].text.includes('partitioning first'), r1.messages[1].text.slice(0, 80));
    check('chatgpt: reasoning summary label dropped',
      !r1.messages[1].thinkingHtml.includes('Thought for 4 seconds'));
    check('chatgpt: line-clamped text captured in full',
      r1.messages[3].text.includes('naive first-element pivot'), r1.messages[3].text.slice(0, 80));
    check('chatgpt: inline image preserved', r1.messages[1].html.includes('data:image/png;base64'));
    check('chatgpt: says it read with rules, not by guessing', r1.source === 'rules', String(r1.source));
    check('chatgpt: health is good', r1.health?.status === 'ok', JSON.stringify(r1.health?.problems || []));
    check('chatgpt: health counts both speakers',
      r1.health?.counts?.user === 3 && r1.health?.counts?.assistant === 3, JSON.stringify(r1.health?.counts));
    check('chatgpt: reasoning counted for the rule manager', r1.health?.parts?.thinking === 1,
      String(r1.health?.parts?.thinking));

    /* --------------- fixture 2: virtualised list ------------------------- */
    const r2 = await runExtractor('fixture-virtual.html', chatgpt);
    check('virtualised: extraction succeeded', r2.ok === true, r2.error || '');
    check('virtualised: all 24 messages harvested across the scroll',
      r2.messages.length === 24, `got ${r2.messages.length}`);
    const seq = r2.messages.map((m) => {
      const match = /zulu-(\d+)-alpha/.exec(m.text);
      return match ? Number(match[1]) : -1;
    });
    check('virtualised: reassembled in document order', seq.every((n, i) => n === i + 1), seq.join(','));
    check('virtualised: no duplicated turns', new Set(seq).size === seq.length);
    if (r2.messages.length !== 24) for (const l of r2.log) say(`    [scroll] ${l}`);

    /* --------------- fixture 3: unknown site, heuristic ------------------ */
    const r3 = await runExtractor('fixture-unknown.html', null);
    check('unknown site: extraction succeeded', r3.ok === true, r3.error || '');
    check('unknown site: heuristic found all 6 turns',
      r3.messages.length === 6, `got ${r3.messages.length} :: ${(r3.log || []).join(' / ')}`);
    check('unknown site: nav and footer excluded',
      !r3.messages.some((m) => /Logout|Some AI company/.test(m.text)),
      r3.messages.map((m) => m.text.slice(0, 20)).join(' | '));
    check('unknown site: roles inferred from styling',
      r3.messages[0].role === 'user' && r3.messages[1].role === 'assistant',
      r3.messages.map((m) => m.role).join(','));
    check('unknown site: says the layout was guessed', r3.source === 'guess', String(r3.source));

    /* --------------- a redesign: built-in rules stop matching ---------- */
    // The failure that prompted site rules. The built-in rules no longer fit,
    // and a sidebar of past chats holds more text than the short conversation.
    const r7 = await runExtractor('fixture-redesign.html', chatgpt, { waitForMessagesMs: 400 });
    check('redesign: rules that no longer fit fail instead of guessing', r7.ok === false,
      `ok=${r7.ok} messages=${r7.messages?.length}`);
    check('redesign: the failure says why', r7.reason === 'rules-found-nothing', String(r7.reason));
    check('redesign: nothing from the sidebar was read', !(r7.messages || []).length);
    check('redesign: health marks the rules broken',
      r7.health?.status === 'broken' &&
      ['user', 'assistant', 'message'].every((part) => r7.health.problems.some((p) => p.code === 'part-empty' && p.part === part)),
      JSON.stringify(r7.health));
    check('redesign: names the rules that failed', r7.rules?.id === 'chatgpt' && /ChatGPT/.test(r7.message || ''),
      r7.message);

    const r8 = await runExtractor('fixture-redesign.html', null);
    check('redesign, guessing: the conversation, not the list of chats',
      r8.ok === true && r8.messages.length === 4 && r8.messages[0].text.includes('three ideas for a weekend'),
      `${r8.messages?.length} :: ${(r8.messages || []).map((m) => m.text.slice(0, 30)).join(' | ')}`);
    check('redesign, guessing: no sidebar titles anywhere',
      !(r8.messages || []).some((m) => /Docker compose|CAP theorem|Silk Road/.test(m.text)));
    check('redesign, guessing: speakers right from the page itself',
      (r8.messages || []).map((m) => m.role).join(',') === 'user,assistant,user,assistant',
      (r8.messages || []).map((m) => m.role).join(','));
    check('redesign, guessing: health is reported as a guess', r8.source === 'guess' && r8.health?.status === 'ok',
      JSON.stringify(r8.health?.problems || []));

    const redesignRules = taught({
      user: ['article[data-turn="user"]'],
      assistant: ['article[data-turn="assistant"]'],
      exclude: ['.sources'],
    });
    const r9 = await runExtractor('fixture-redesign.html', redesignRules);
    check('redesign, taught: both speakers from two parts', r9.ok === true && r9.messages.length === 4 &&
      r9.messages.map((m) => m.role).join(',') === 'user,assistant,user,assistant',
      (r9.messages || []).map((m) => m.role).join(','));
    check('redesign, taught: "leave out" areas are not exported',
      !(r9.messages || []).some((m) => /Sources:/.test(m.text)), (r9.messages?.[1]?.text || '').slice(-60));
    check('redesign, taught: health is good', r9.health?.status === 'ok', JSON.stringify(r9.health?.problems));
    check('redesign, taught: parts counted', r9.health?.parts?.user === 2 && r9.health?.parts?.assistant === 2,
      JSON.stringify(r9.health?.parts));

    // One part only: what the old single-click picker produced.
    const r10 = await runExtractor('fixture-redesign.html', taught({ user: ['article[data-turn="user"]'] }));
    check('one-sided rules: still read what they find', r10.ok === true && r10.messages.length === 2);
    check('one-sided rules: reported, not passed off as complete',
      r10.health?.status === 'warn' && r10.health.problems.some((p) => p.code === 'one-speaker'),
      JSON.stringify(r10.health?.problems));

    const r11 = await runExtractor('fixture-redesign.html', taught({ message: ['nav a'] }));
    check('rules pointing at navigation: flagged as broken',
      r11.health?.status === 'broken' && r11.health.problems.some((p) => p.code === 'in-navigation'),
      JSON.stringify(r11.health?.problems));

    const r12 = await runExtractor('fixture-redesign.html', taught({
      user: ['article[data-turn="user"]', 'div[[broken'],
      assistant: ['article[data-turn="assistant"]'],
    }));
    check('invalid selector: the valid ones still work', r12.ok === true && r12.messages.length === 4);
    check('invalid selector: reported', r12.health?.problems?.some((p) => p.code === 'invalid-selector'),
      JSON.stringify(r12.health?.problems));

    /* --------------- the same words twice ------------------------------- */
    const r13 = await runExtractor('fixture-repeats.html', chatgpt);
    check('repeats: every message kept', r13.messages?.length === 6, `got ${r13.messages?.length}`);
    check('repeats: "continue" sent twice comes out twice',
      (r13.messages || []).filter((m) => m.text === 'continue').length === 2,
      (r13.messages || []).map((m) => m.text.slice(0, 12)).join(' | '));
    check('repeats: order preserved',
      (r13.messages || []).map((m) => m.role).join(',') === 'user,assistant,user,assistant,user,assistant');

    /* --------------- what someone typed, and what the chat is called ----- */
    const r15 = await runExtractor('fixture-typed.html', chatgpt);
    const typedHtml = r15.messages?.[0]?.html || '';
    check('typed: line breaks in a prompt become real line breaks',
      (typedHtml.match(/<br>/g) || []).length === 5 && typedHtml.includes('Plan a weekend for me:<br>- Saturday'),
      typedHtml.slice(0, 160));
    check('typed: runs of spaces are kept', typedHtml.includes('&nbsp;&nbsp;&nbsp; (this line'), JSON.stringify(typedHtml.slice(-70)));
    check('typed: no stray line break at the end', !/<br>\s*<\/div>\s*$/.test(typedHtml));
    check('typed: words either side of a line break stay apart in the plain text',
      /for me: - Saturday/.test(r15.messages?.[0]?.text || ''), r15.messages?.[0]?.text?.slice(0, 60));
    const typedPrepared = convert.prepare(r15, {});
    check('typed: the Markdown keeps the lines', /for me: {2}\n\\?- Saturday/.test(typedPrepared.messages[0].markdown),
      JSON.stringify(typedPrepared.messages[0].markdown.slice(0, 60)));
    check('typed: replies in rendered markdown are left alone', !(r15.messages?.[1]?.html || '').includes('<br>'));
    check('title: the name from the list of chats, not the site name in the tab',
      r15.title === 'Weekend plans in the mountains', r15.title);
    const menus = await getFixtureWindow().webContents.executeJavaScript(
      `({ menu: window.__menuOpened === true, more: !document.querySelector('main p[hidden]') })`);
    check('expand: menus outside the chat are not opened', menus.menu === false, JSON.stringify(menus));
    check('expand: "Show more" inside a message still is', menus.more === true, JSON.stringify(menus));
    const untitled = await runExtractor('fixture-typed.html', chatgpt, {}, `
      document.title = 'ChatGPT'; document.getElementById('self').remove(); document.querySelector('h1').remove();`);
    check('title: falls back to the opening words of the first prompt, never an id',
      untitled.title === 'Plan a weekend for me: - Saturday: hiking - Sunday:', untitled.title);

    /* --------------- one speaker inside another ------------------------- */
    // Pointing at the question half and at the whole exchange: the question is
    // cut out of the exchange and read on its own, before the answer.
    const r14 = await runExtractor('fixture-exchange.html', taught({
      user: ['.exchange > div:first-child'],
      assistant: ['.exchange'],
    }));
    check('nested speakers: every exchange split in two', r14.messages?.length === 8, `got ${r14.messages?.length}`);
    check('nested speakers: question before answer',
      (r14.messages || []).map((m) => m.role).join(',') ===
        'user,assistant,user,assistant,user,assistant,user,assistant',
      (r14.messages || []).map((m) => m.role).join(','));
    check('nested speakers: the question is not repeated inside the answer',
      !(r14.messages?.[1]?.text || '').includes('تنظیمات پیشنهادی من'), (r14.messages?.[1]?.text || '').slice(0, 60));
    check('nested speakers: the answer is intact', (r14.messages?.[1]?.text || '').includes('قابل اجرا'));

    /* --------------- code-block toolbars ------------------------------- */
    // Several front-ends put a language label and copy button inside the <pre>.
    // Left there they become part of the code itself.
    const r4 = await runExtractor('fixture-codeblock.html', chatgpt);
    check('code toolbar: extraction succeeded', r4.ok === true, r4.error || '');
    const answer = r4.messages?.[1]?.html || '';
    check('code toolbar: header markup removed from the code block',
      !/code-header|language-label/.test(answer), answer.slice(0, 160));
    check('code toolbar: label text not prepended to the code',
      /<code[^>]*>1: 92/.test(answer), answer.slice(0, 300));
    check('code toolbar: language recovered from the label',
      /language-python/.test(answer), (answer.match(/language-[a-z]+/g) || []).join(','));
    check('code toolbar: an already-labelled block keeps its language',
      /language-js/.test(answer));
    check('code toolbar: code content itself is intact',
      answer.includes('def roll()') && answer.includes('const x = 1;'));

    /* --------------- one element holding both speakers ----------------- */
    // GapGPT-style: each match is a whole exchange with no classes to tell the
    // two halves apart, only the fact that the answer is rendered markdown.
    const gap = builtin('gapgpt');
    const r5 = await runExtractor('fixture-exchange.html', gap);
    check('exchange: extraction succeeded', r5.ok === true, r5.error || '');
    check('exchange: both speakers recovered, not merged',
      r5.messages?.length === 8, `got ${r5.messages?.length}`);
    check('exchange: roles alternate question then answer',
      r5.messages?.map((m) => m.role).join(',') ===
        'user,assistant,user,assistant,user,assistant,user,assistant',
      r5.messages?.map((m) => m.role).join(','));
    check('exchange: the user question is present on its own',
      r5.messages?.[0]?.text.includes('تنظیمات پیشنهادی من'), r5.messages?.[0]?.text.slice(0, 50));
    check('exchange: the answer is present on its own',
      r5.messages?.[1]?.text.includes('قابل اجرا'), r5.messages?.[1]?.text.slice(0, 50));
    check('exchange: question and answer are not fused',
      !r5.messages?.[0]?.text.includes('قابل اجرا'), r5.messages?.[0]?.text.slice(0, 60));
    check('exchange: code survives inside the answer',
      r5.messages?.[3]?.html.includes('def roll()'));
    check('exchange: code toolbar stripped here too',
      !/code-header|language-label/.test(r5.messages?.[3]?.html || ''));

    const lastAnswer = r5.messages?.[5]?.html || '';
    check('collapsed block: the disclosure header is not treated as content',
      !/expandable-header|toggle-icon/.test(lastAnswer) &&
      !(r5.messages?.[5]?.text || '').includes('مشاهده مراحل استنتاج'),
      (r5.messages?.[5]?.text || '').slice(0, 70));
    check('collapsed block: content hidden by the site is still captured',
      lastAnswer.includes('Planning the explanation'));
    // Capturing collapsed content is pointless if it stays hidden in the file.
    check('collapsed block: inline display:none removed so it is visible',
      !/display:\s*none/i.test(lastAnswer),
      (lastAnswer.match(/style="[^"]*"/g) || []).join(' '));
    check('collapsed block: the answer itself is intact',
      lastAnswer.includes('explanation in English'));

    // An image-generation reply has no markdown at all, and the picture sits
    // inside a button so it can be clicked to enlarge. Stripping buttons as
    // chrome used to take the picture with it and lose the whole reply.
    const imageReply = r5.messages?.[7]?.html || '';
    check('image reply: the exchange was still split',
      r5.messages?.length === 8, `got ${r5.messages?.length}`);
    check('image reply: the prompt is its own user message',
      (r5.messages?.[6]?.text || '').includes('یک تصویر'), (r5.messages?.[6]?.text || '').slice(0, 40));
    check('image reply: the picture survived the strip list',
      imageReply.includes('<img') && imageReply.includes('data:image/png'),
      imageReply.slice(0, 120));
    check('image reply: the alt text came with it', imageReply.includes('a generated cat'));
    check('image reply: action buttons with no content still stripped',
      !/Download|Regenerate/.test(imageReply), imageReply.slice(0, 160));

    /* --------------- attachments beside the text ----------------------- */
    // A screenshot attached to a question sits outside the pack's content
    // selector, so narrowing the turn to that selector used to drop it.
    const r6 = await runExtractor('fixture-attachment.html', chatgpt);
    check('attachment: extraction succeeded', r6.ok === true, r6.error || '');
    check('attachment: all four turns read', r6.messages?.length === 4, `got ${r6.messages?.length}`);
    check('attachment: the attached picture is kept',
      (r6.messages?.[0]?.html || '').includes('<img'), (r6.messages?.[0]?.html || '').slice(0, 130));
    check('attachment: its alt text came with it',
      (r6.messages?.[0]?.html || '').includes('Screenshot of the settings window'));
    check('attachment: the question text is still there',
      (r6.messages?.[0]?.text || '').includes('dialog'), (r6.messages?.[0]?.text || '').slice(0, 60));
    check('attachment: a picture below the text is kept too',
      (r6.messages?.[2]?.html || '').includes('Second screenshot'));
    check('attachment: document order preserved when text comes first',
      (r6.messages?.[2]?.html || '').indexOf('And this one') <
        (r6.messages?.[2]?.html || '').indexOf('<img'));
    check('attachment: replies without attachments are unaffected',
      (r6.messages?.[1]?.text || '').includes('confirm before continuing'));

    /* --------------- teaching: the app's first guess -------------------- */
    await loadFixture('fixture-redesign.html');
    const guessRun = startTeach({ mode: 'teach', rules: null, siteName: 'chatgpt.com' });
    await sleep(400);
    const guessState = await overlay(`return {
      text: root.querySelector('.panel').innerText,
      boxes: Array.from(root.querySelectorAll('.box')).filter((b) => b.style.display === 'block').length,
    };`);
    check('teach: opens over the page', Boolean(guessState), 'no overlay found');
    check('teach: proposes rules for a site that has none',
      /first guess/.test(guessState?.text || '') && /4\s+messages/.test(guessState?.text || ''),
      (guessState?.text || '').replace(/\s+/g, ' ').slice(0, 200));
    check('teach: draws a box for every message it found', guessState?.boxes >= 4, String(guessState?.boxes));
    await overlay(`return press('Save rules') && press('Save these rules');`);
    const guessed = await guessRun;
    check('teach: saving returns the rules', guessed?.action === 'save' && guessed.parts?.user?.length > 0,
      JSON.stringify(guessed?.parts));
    check('teach: the guess tells the speakers apart',
      /user/.test(guessed?.parts?.user?.[0] || '') && /assistant/.test(guessed?.parts?.assistant?.[0] || ''),
      JSON.stringify(guessed?.parts));
    const guessedRead = await runExtractor('fixture-redesign.html', taught(guessed.parts, guessed.options));
    check('teach: the guessed rules read the chat correctly',
      guessedRead.messages?.map((m) => m.role).join(',') === 'user,assistant,user,assistant' &&
      !guessedRead.messages.some((m) => /Docker compose/.test(m.text)),
      guessedRead.messages?.map((m) => m.role).join(','));
    check('teach: overlay removed once saved',
      await getFixtureWindow().webContents.executeJavaScript(`!document.getElementById('__ace_teach__')`));

    /* --------------- teaching: repairing rules after a redesign ---------- */
    // The fix for the failure that started all this: rules that find nothing
    // get a fresh guess for the new layout, and the old ones stay one Undo away.
    await loadFixture('fixture-redesign.html');
    const repairRun = startTeach({ mode: 'teach', rules: siteRules.builtinById('chatgpt'), siteName: 'chatgpt.com' });
    await sleep(400);
    const repairText = await overlay(`return root.querySelector('.panel').innerText;`);
    check('repair: says the old rules find nothing and offers a new guess',
      /old rules find nothing/.test(repairText || '') && /4\s+messages/.test(repairText || ''),
      (repairText || '').replace(/\s+/g, ' ').slice(0, 200));
    await overlay(`return press('Save rules') && press('Save these rules');`);
    const repaired = await repairRun;
    check('repair: the new rules fit the new layout',
      /data-turn="user"/.test(repaired?.parts?.user?.[0] || '') && /data-turn="assistant"/.test(repaired?.parts?.assistant?.[0] || ''),
      JSON.stringify(repaired?.parts?.user));
    check('repair: the parts that were not broken are kept',
      Boolean(repaired?.parts?.body?.length && repaired?.parts?.thinking?.length), Object.keys(repaired?.parts || {}).join(','));

    /* --------------- teaching: pointing by hand ------------------------- */
    await loadFixture('fixture-unknown.html');
    const handRun = startTeach({ mode: 'teach', rules: null, siteName: 'unknown.example', guess: false });
    await sleep(300);
    await clickOnPage('.b.me');
    const pendingUser = await overlay(`return root.querySelector('.card.pending')?.innerText || '';`);
    check('teach: a click proposes a way and shows how many it finds', /3 boxes/.test(pendingUser),
      pendingUser.replace(/\s+/g, ' ').slice(0, 100));
    await overlay(`return press('✓ Add');`);
    const nextPart = await overlay(`return root.querySelector('.part.active')?.innerText || '';`);
    check('teach: moves on to the AI replies by itself', /AI replies/.test(nextPart), nextPart);
    await clickOnPage('.b:not(.me)');
    const pendingAi = await overlay(`return root.querySelector('.card.pending')?.innerText || '';`);
    check('teach: narrows a way that would also catch your messages',
      /3 boxes/.test(pendingAi) && !/already another part/.test(pendingAi), pendingAi.replace(/\s+/g, ' ').slice(0, 140));
    await overlay(`return press('✓ Add');`);
    await overlay(`return press('Save rules') && press('Save these rules');`);
    const hand = await handRun;
    const handRead = await runExtractor('fixture-unknown.html', taught(hand.parts));
    check('teach: rules taught by hand read the chat',
      handRead.messages?.length === 6 &&
      handRead.messages.map((m) => m.role).join(',') === 'user,assistant,user,assistant,user,assistant',
      `${JSON.stringify(hand.parts)} -> ${handRead.messages?.map((m) => m.role).join(',')}`);

    /* --------------- teaching: bigger, smaller, undo, cancel ------------- */
    await loadFixture('fixture-chatgpt.html');
    const sizeRun = startTeach({ mode: 'teach', rules: null, siteName: 'chatgpt.test', guess: false, focus: 'assistant' });
    await sleep(300);
    await clickOnPage('[data-message-author-role="assistant"] .markdown p');
    const sizes = [];
    sizes.push(await overlay(`return root.querySelector('.card.pending .summary')?.textContent;`));
    await overlay(`return press('▼ Smaller');`);
    sizes.push(await overlay(`return root.querySelector('.card.pending .summary')?.textContent;`));
    check('teach: the whole message is offered first, smaller on request',
      /^3 boxes/.test(sizes[0] || '') && /boxes/.test(sizes[1] || ''), sizes.join(' / '));
    await overlay(`return press('✓ Add');`);
    await overlay(`return press('Undo');`);
    const afterUndo = await overlay(`return root.querySelector('.part.active .count')?.textContent;`);
    check('teach: undo takes the last change back', afterUndo === '—', String(afterUndo));
    await getFixtureWindow().webContents.executeJavaScript(inject.CLOSE_TEACH_SOURCE, true);
    const cancelled = await sizeRun;
    check('teach: closing from outside cancels cleanly', cancelled?.ok === false && cancelled.cancelled === true);

    /* --------------- show mode ------------------------------------------ */
    const showRun = startTeach({ mode: 'show', rules: siteRules.builtinById('chatgpt'), siteName: 'chatgpt.test' });
    await sleep(300);
    const shown = await overlay(`return root.querySelector('.panel').innerText;`);
    check('show: lists each part with what it finds',
      /Your messages\s+3/.test(shown || '') && /AI replies\s+3/.test(shown || ''), (shown || '').replace(/\s+/g, ' ').slice(0, 160));
    check('show: an optional part with nothing to find is not flagged',
      /Reasoning\s+0(?!\s*⚠)/.test(shown || ''), (shown || '').replace(/\s+/g, ' ').slice(0, 220));
    await overlay(`return press('Close');`);
    const closed = await showRun;
    check('show: closing reports what was on the page', closed?.action === 'close' && closed.summary?.messages === 6,
      JSON.stringify(closed?.summary));

    await loadFixture('fixture-redesign.html');
    const brokenRun = startTeach({ mode: 'show', rules: siteRules.builtinById('chatgpt'), siteName: 'chatgpt.com' });
    await sleep(300);
    const broken = await overlay(`return root.querySelector('.panel').innerText;`);
    check('show: rules that no longer fit say so in plain words',
      /“Your messages” finds nothing/.test(broken || '') && /“AI replies” finds nothing/.test(broken || ''),
      (broken || '').replace(/\s+/g, ' ').slice(0, 200));
    await overlay(`return press('Close');`);
    await brokenRun;

    if (fixtureWin && !fixtureWin.isDestroyed()) fixtureWin.destroy();

    /* --------------- capture paths --------------------------------------- */
    const prepared = convert.prepare({ ...r1, providerName: 'ChatGPT' },
      { includeThinking: true, includeSystem: true, redactions: [] });
    const html = renderHtml(prepared, { theme: 'light' });

    const pdf = await capture.pdfFromHtml(html, { pageSize: 'A4', marginInches: 0.5, pageNumbers: true }, prepared.title);
    check('pdf: produced a real PDF', Buffer.isBuffer(pdf) && pdf.slice(0, 5).toString() === '%PDF-', `${pdf.length} bytes`);
    fs.writeFileSync(path.join(outDir, 'sample.pdf'), pdf);

    say('  … starting png capture');
    const shot = await capture.screenshotHtml(html, {
      format: 'png',
      viewportWidth: 900,
      trace: (m) => say(`    [capture] ${m}`),
    });
    say('  … png capture returned');
    check('png: produced a real PNG', shot.images[0].slice(1, 4).toString() === 'PNG', `${shot.images[0].length} bytes`);
    check('png: captured beyond the viewport', shot.height > 700, `full height ${shot.height}px`);
    fs.writeFileSync(path.join(outDir, 'sample.png'), shot.images[0]);

    const jpg = await capture.screenshotHtml(html, { format: 'jpeg', quality: 85, viewportWidth: 900 });
    check('jpeg: produced a real JPEG', jpg.images[0][0] === 0xff && jpg.images[0][1] === 0xd8);

    /* --------------- the real UI boots ----------------------------------- */
    const appErrors = [];
    const win = new BrowserWindow({
      show: false, width: 1500, height: 950,
      webPreferences: {
        preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true,
      },
    });
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) appErrors.push(message);
    });
    win.webContents.on('preload-error', (_e, _p, err) => appErrors.push(`preload: ${err.message}`));
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await new Promise((r) => setTimeout(r, 1200));
    const ui = await win.webContents.executeJavaScript(`(() => ({
      hasApi: typeof window.ace === 'object',
      tabs: document.querySelectorAll('.tab').length,
      formats: document.querySelectorAll('#formats input').length,
      webviewPresent: !!document.getElementById('view'),
      shared: typeof window.AceParts === 'object' && typeof window.AceHelp === 'object',
    }))()`);
    check('ui: preload bridge exposed', ui.hasApi === true);
    check('ui: all six tabs rendered', ui.tabs === 6, String(ui.tabs));
    check('ui: shared part colours and help loaded in the renderer', ui.shared === true);
    check('ui: ten formats offered', ui.formats === 10, String(ui.formats));
    check('ui: webview element present', ui.webviewPresent === true);
    // Two expected messages are filtered out:
    //  - settings:get rejects because this harness skips main.js, so none of
    //    the IPC handlers it registers exist;
    //  - the allowpopups notice is a development-only warning about a setting
    //    the app needs deliberately, so third-party sign-in popups work.
    const unexpected = appErrors.filter(
      (m) => !/No handler registered|settings:get|Security Warning \(allowpopups\)/.test(m)
    );
    check('ui: no unexpected console errors', unexpected.length === 0, unexpected.join(' | '));
    win.destroy();

    say(`\nSample output written to ${outDir}`);
  } catch (err) {
    failures++;
    say('FAIL  harness threw — ' + (err.stack || err));
  }

  say(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  app.exit(failures === 0 ? 0 : 1);
});
