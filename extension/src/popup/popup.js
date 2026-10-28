'use strict';

const {
  api, ensureHostAccess, ensureContentScript, isScriptableUrl, activeTab, sendToTab,
} = require('../lib/browser');
const { getSiteRules } = require('../lib/storage');
const rules = require('../../../src/shared/rules');

/**
 * The popup stays deliberately thin.
 *
 * A popup closes the moment it loses focus, which would abandon a capture
 * halfway through a long conversation. So every button here just opens the
 * workspace tab — which stays put — and lets it do the work.
 */

const $ = (id) => document.getElementById(id);

function setSite(html, cls = '') {
  const el = $('site');
  el.className = `site ${cls}`.trim();
  el.innerHTML = '';
  el.append(...html);
}

function line(text, bold = false) {
  const node = document.createElement(bold ? 'strong' : 'span');
  node.textContent = text;
  return node;
}

async function openWorkspace(query) {
  const tab = await activeTab();
  const url = api.runtime.getURL(`panel.html${query}${query.includes('?') ? '&' : '?'}tabId=${tab?.id ?? ''}`);
  await api.tabs.create({ url });
  window.close();
}

async function init() {
  const tab = await activeTab();

  if (!tab || !isScriptableUrl(tab.url)) {
    setSite([line('Not a web page', true), line('Open a chat first — this cannot read browser or extension pages.')]);
    $('hint').textContent = 'The Library and Workspace still work from here.';
    return;
  }

  await ensureHostAccess();

  try {
    await ensureContentScript(tab.id);
    const info = await sendToTab(tab.id, { type: 'ace:describe' });
    const site = rules.siteSummary(tab.url, await getSiteRules());
    const broken = site.set && site.set.health && site.set.health.status === 'broken';

    let words;
    if (site.set) {
      words = broken
        ? 'Its rules stopped working last time — open the workspace to fix them.'
        : site.source === 'user' ? 'Read with your own rules.' : 'Read with the built-in rules.';
    } else if (site.off) {
      words = 'Its rules are turned off, so the layout will be guessed.';
    } else {
      words = 'No rules for this site yet — the layout will be guessed. Teach it from the workspace.';
    }
    setSite(
      [line(site.name || info.host, true), line(words)],
      site.set && !broken ? 'known' : 'guess'
    );

    $('openBtn').disabled = false;
    $('quickBtn').disabled = false;
  } catch (err) {
    setSite([line('Could not reach this page', true), line(err.message || String(err))]);
    $('hint').textContent =
      'Some pages block extensions. Try reloading the tab, or check that access to this site is allowed.';
  }
}

$('openBtn').addEventListener('click', () => openWorkspace('?capture=1'));
$('quickBtn').addEventListener('click', () => openWorkspace('?capture=1&auto=1'));
$('libraryBtn').addEventListener('click', () => openWorkspace('?tab=library'));
$('rulesBtn').addEventListener('click', () => openWorkspace('?tab=rules'));
$('workspaceBtn').addEventListener('click', () => openWorkspace('?'));
$('manualBtn').addEventListener('click', () => openWorkspace('?help=1'));

init();
