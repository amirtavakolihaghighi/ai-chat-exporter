/**
 * Interface pieces both apps share: the coloured part chips, the reading
 * result, the rule cards of the rule manager, the colour legend, the manual
 * viewer and "What's this?" mode.
 *
 * The desktop app and the extension reach their data differently — one over
 * IPC, the other through extension storage — so every piece here takes the
 * data and the actions it needs as arguments and does nothing else. What they
 * show and how they behave is then the same in both, by construction.
 *
 * Builds everything from elements, never from markup strings, except the
 * manual, which is the app's own document. Styles live in src/shared/ui.css.
 *
 * Loaded like src/shared/parts.js: a CommonJS module, or a plain <script> in
 * the desktop renderer, where it defines `AceUI`. Needs AceParts and AceHelp.
 */
(function (root, factory) {
  const deps =
    typeof module !== 'undefined' && module.exports
      ? { parts: require('./parts'), help: require('./help') }
      : { parts: root.AceParts, help: root.AceHelp };
  const value = factory(deps.parts, deps.help);
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
  else root.AceUI = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PartsLib, HelpLib) {
  'use strict';

  const { PARTS, STATUS, partByKey } = PartsLib;

  /* ---------------------------------------------------------------- kit */

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function button(label, cls, onClick, title) {
    const node = el('button', cls, label);
    node.type = 'button';
    if (title) node.title = title;
    node.addEventListener('click', (e) => {
      e.preventDefault();
      onClick(e);
    });
    return node;
  }

  function paint(node, colour) {
    node.style.setProperty('--c', colour);
    return node;
  }

  function tag(text, cls = '') {
    return el('span', `tag ${cls}`.trim(), text);
  }

  function shortDate(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  /* -------------------------------------------------------------- health */

  function statusOf(set) {
    if (!set) return 'unknown';
    if (set.enabled === false) return 'off';
    return (set.health && set.health.status) || 'unknown';
  }

  /** Turns a read's health problems into sentences. */
  function describeProblems(health) {
    const out = [];
    for (const p of (health && health.problems) || []) {
      const part = partByKey(p.part);
      switch (p.code) {
        case 'part-empty':
          out.push(`“${part ? part.label : 'A part'}” found nothing — the site may have changed how these look.`);
          break;
        case 'one-speaker':
          out.push(p.part === 'assistant'
            ? 'Only your messages were found, none from the AI.'
            : 'Only the AI’s replies were found, none of your messages.');
          break;
        case 'in-navigation':
          out.push(p.severity === 'error'
            ? 'Most of what was read is in the site’s menu or sidebar, not the chat.'
            : 'Some of what was read is in the site’s menu or sidebar.');
          break;
        case 'invalid-selector':
          out.push('Some of the rules are no longer valid and were skipped.');
          break;
        case 'no-messages':
          out.push('No messages were found.');
          break;
        default:
          break;
      }
    }
    return out;
  }

  /** The part to start on when fixing rules that went wrong. */
  function focusFor(health) {
    for (const p of (health && health.problems) || []) {
      if ((p.code === 'part-empty' || p.code === 'one-speaker') && p.part && p.part !== 'message') return p.part;
    }
    return 'user';
  }

  /** "✓ Worked on 27 Oct — 12 messages", in words a person reads at a glance. */
  function healthLine(health) {
    if (!health) return 'Not checked yet — read a chat, or press “Show on page”.';
    const when = shortDate(health.at);
    const counts = health.counts || {};
    const total = counts.total ?? (counts.user || 0) + (counts.assistant || 0);
    if (health.status === 'ok') {
      return `✓ Worked on ${when} — ${total} messages (${counts.user || 0} yours, ${counts.assistant || 0} AI)`;
    }
    if (health.status === 'warn') return `⚠ Needs a look (${when}): ${describeProblems(health)[0] || 'see the last read'}`;
    return `✕ Broken on ${when}: ${describeProblems(health)[0] || 'it found nothing'}`;
  }

  /** What a rule set's chips should count: the last read, or something newer. */
  function countsOf(set, live) {
    if (live) return live;
    return set && set.health ? { ...set.health.parts, found: set.health.found } : null;
  }

  /** One coloured chip per part a rule set uses, with what it found last. */
  function partChips(set, counts) {
    const box = el('div', 'chips');
    for (const part of PARTS) {
      if (!set.parts[part.key] || !set.parts[part.key].length) continue;
      const chip = paint(el('span', 'chip'), part.color);
      chip.title = `${part.label}: ${part.help}`;
      chip.append(el('i'), document.createTextNode(part.short));
      const n = counts ? counts[part.key] : undefined;
      if (n !== undefined) {
        chip.append(el('b', '', String(n)));
        if (!n) {
          const missing = part.group === 'message' && !(counts.found && counts.found[part.key]);
          chip.classList.add(missing ? 'zero' : 'quiet');
        }
      }
      box.appendChild(chip);
    }
    return box;
  }

  /* --------------------------------------------------------- the legend */

  /**
   * The colour key: compact swatches always on show, the explanation of each a
   * click away — there is no room to spare above the rules themselves.
   */
  function renderLegend(host, explainedHost) {
    host.textContent = '';
    if (explainedHost) explainedHost.textContent = '';
    for (const part of PARTS) {
      const skip = part.key === 'exclude' ? ' skip' : '';
      const item = paint(el('div', `item${skip}`), part.color);
      item.title = part.help;
      item.append(el('i'), el('span', '', part.label));
      host.appendChild(item);
      if (explainedHost) {
        const explained = paint(el('div', `item${skip}`), part.color);
        const words = el('span');
        words.append(el('strong', '', part.label), document.createTextNode(` — ${part.help}`));
        explained.append(el('i'), words);
        explainedHost.appendChild(explained);
      }
    }
  }

  /* --------------------------------------------------- reading result */

  /** "your rules “Work layout”" or "the built-in rules for ChatGPT". */
  function rulesPhrase(rules) {
    if (!rules) return 'the rules for this site';
    return rules.origin === 'user' ? `your rules “${rules.name}”` : `the built-in rules for ${rules.name}`;
  }

  /**
   * The reading result, said plainly: what was found, how, what looks wrong —
   * and a button for whatever would fix it.
   *
   * actions: { fix(focus), guess(), show(), teach() }
   * previous: the last export of this same chat, { messageCount }, or null
   */
  function renderReadStatus(box, result, previous, actions) {
    box.textContent = '';
    const lead = el('span', 'lead');
    const problems = [];
    const row = el('div', 'status-actions');
    let cls = 'ok';

    if (!result || result.error) {
      cls = 'err';
      lead.textContent = `Reading failed: ${String((result && result.error) || 'the page did not answer').split('\n')[0]}`;
    } else if (!result.ok && result.reason === 'rules-found-nothing') {
      cls = 'err';
      const phrase = rulesPhrase(result.rules);
      lead.textContent = `${phrase[0].toUpperCase()}${phrase.slice(1)} found no messages on this page. The site may have changed its design.`;
      row.append(
        button('✎ Fix the rules', 'btn primary', () => actions.fix('user')),
        button('Read once by guessing', 'btn', () => actions.guess()),
        button('Show what they find', 'btn', () => actions.show())
      );
    } else if (!result.ok) {
      cls = 'err';
      lead.textContent = 'No messages were found on this page. Make sure the chat itself is showing, or teach the app this site.';
      row.append(button('✎ Teach this site', 'btn primary', () => actions.teach()));
    } else {
      const s = result.stats;
      const facts =
        `${s.messages} messages · ${s.characters.toLocaleString()} characters` +
        (s.images ? ` · ${s.images} images embedded` : '') +
        (s.imagesFailed ? ` · ${s.imagesFailed} images unavailable` : '');
      if (result.source === 'guess') {
        cls = 'warn';
        lead.textContent = `${facts} · the layout was guessed, because this site has no rules. Check the preview.`;
        row.append(button('✎ Teach this site', 'btn primary', () => actions.teach()));
      } else {
        const status = (result.health && result.health.status) || 'ok';
        cls = status === 'broken' ? 'err' : status === 'warn' ? 'warn' : 'ok';
        lead.textContent = `${status === 'ok' ? '✓ ' : ''}${facts} · read with ${rulesPhrase(result.rules)}`;
        problems.push(...describeProblems(result.health));
        if (status !== 'ok') {
          row.append(
            button('✎ Fix the rules', 'btn primary', () => actions.fix(focusFor(result.health))),
            button('Show on page', 'btn', () => actions.show())
          );
        }
      }
      if (s.stoppedEarly) {
        problems.push('Reading took too long and was stopped early, so some messages may be missing. Raise “Give up reading after” in Options and read again.');
        if (cls === 'ok') cls = 'warn';
      }
      if (previous && previous.messageCount >= 4 && s.messages < previous.messageCount * 0.6) {
        problems.push(`Last time you exported this chat it had ${previous.messageCount} messages; this read found ${s.messages}.`);
        if (cls === 'ok') cls = 'warn';
      }
    }

    box.className = `extract-status ${cls}`;
    box.appendChild(lead);
    if (problems.length) {
      const list = el('ul');
      for (const text of problems) list.appendChild(el('li', '', text));
      box.appendChild(list);
    }
    if (row.children.length) box.appendChild(row);
    return cls;
  }

  /* ------------------------------------------------------- rule cards */

  function hostsLine(set) {
    const hosts = set.hosts.join(' · ');
    return set.pathPrefix ? `${hosts} — only ${set.pathPrefix}… pages` : hosts;
  }

  /** The technical view: every part's selectors, editable for your own rules. */
  function technicalDetails(set, save) {
    const box = el('div', 'tech');
    const own = set.origin === 'user';
    box.appendChild(el('p', 'note', own
      ? 'For people who know CSS. One selector per line; a box is found if any line matches it. Most people never need this — use “Fix” and point at the page instead.'
      : 'The CSS selectors behind these built-in rules, read-only. Make your own copy to change them.'));
    const fields = {};
    for (const part of PARTS) {
      const list = set.parts[part.key] || [];
      if (!own && !list.length) continue;
      const row = el('div', 'techpart');
      const label = paint(el('label'), part.color);
      label.append(el('i'), document.createTextNode(part.label));
      const area = el('textarea');
      area.spellcheck = false;
      area.rows = Math.max(1, Math.min(5, list.length || 1));
      area.value = list.join('\n');
      area.readOnly = !own;
      fields[part.key] = area;
      row.append(label, area);
      box.appendChild(row);
    }
    if (own) {
      box.appendChild(button('Save changes', 'btn', () => {
        const parts = {};
        for (const [key, area] of Object.entries(fields)) {
          const lines = area.value.split('\n').map((l) => l.trim()).filter(Boolean);
          if (lines.length) parts[key] = lines;
        }
        save(parts);
      }));
    }
    return box;
  }

  /**
   * One rule set, as a row in its site's card.
   *
   * actions: {
   *   use(), show(), fix(), rename(name), copy(), exportRules(), remove(),
   *   removeBuiltin(), restore(), saveParts(parts), confirm(question) -> boolean
   * }
   * usable: whether the page open right now is one these rules cover.
   */
  function setRow(set, group, actions, { usable = false } = {}) {
    const own = set.origin === 'user';
    const inUse = set.id === group.defaultId;
    const scoped = Boolean(set.pathPrefix);
    const status = statusOf(set);
    const row = el('div', `setrow${inUse ? ' inuse' : ''}${set.removed ? ' off' : ''}`);

    const head = el('div', 'setrow-head');
    if (set.removed || scoped) {
      // Not a choice for the whole site: removed, or only for some of its pages.
      head.appendChild(el('span', 'pick-placeholder'));
    } else {
      const pick = el('input');
      pick.type = 'radio';
      pick.name = `use-${group.key}`;
      pick.checked = inUse;
      pick.title = 'Use these rules for this site';
      pick.dataset.help = 'rules-use';
      pick.addEventListener('change', () => {
        if (pick.checked) actions.use();
      });
      head.appendChild(pick);
    }
    const dot = paint(el('span', 'dot'), STATUS[status].color);
    dot.title = STATUS[status].label;
    const nameBlock = el('div', 'rulecard-name');
    nameBlock.append(el('strong', '', set.name), el('small', '', hostsLine(set)));
    head.append(dot, nameBlock);
    if (inUse) head.appendChild(tag('In use', 'inuse'));
    if (own) head.appendChild(tag('Yours', 'yours'));
    else head.appendChild(tag(set.verified ? 'Built-in ✓' : 'Built-in', set.verified ? 'verified' : ''));
    if (set.legacy) head.appendChild(tag('Old picker', 'legacy'));
    row.appendChild(head);

    row.appendChild(partChips(set, countsOf(set)));
    row.appendChild(el('div', `health ${status === 'off' ? '' : status}`,
      set.removed ? 'Removed — not used to read anything.'
        : set.enabled === false ? 'Turned off — not used until you choose it.'
          : healthLine(set.health)));
    if (scoped) row.appendChild(el('div', 'note', `Used on ${set.hosts[0]}${set.pathPrefix}… pages, whichever rules the rest of the site uses.`));
    if (set.legacy) {
      row.appendChild(el('div', 'note', 'Made with the old one-click picker, which could only find one kind of message. Press “Fix” on a chat from this site to point at both speakers.'));
    }

    const buttons = el('div', 'actions');
    if (set.removed) {
      buttons.appendChild(button('Restore', 'btn', () => actions.restore()));
    } else if (usable) {
      buttons.append(
        button('Show on page', 'btn', () => actions.show(), 'Draw what these rules find on the open page'),
        button('✎ Fix', 'btn', () => actions.fix(), 'Point at the right things on the open page')
      );
    } else {
      buttons.appendChild(el('span', 'note', `Open a chat on ${set.hosts.find((h) => h.includes('.')) || set.hosts[0]} to show or fix these.`));
    }
    const more = el('div', 'more');
    more.hidden = true;
    if (!set.removed) {
      buttons.appendChild(button('More ▾', 'btn', () => {
        more.hidden = !more.hidden;
      }));
    }
    row.appendChild(buttons);

    const moreButtons = el('div', 'actions');
    const copy = button('Make a copy', 'btn', () => actions.copy(), own
      ? 'A new rule set of your own, starting from these'
      : 'A rule set of your own, starting from the built-in one, to change');
    copy.dataset.help = 'rules-copy';
    if (own) {
      moreButtons.append(
        button('Rename', 'btn', () => {
          const input = el('input', 'rename');
          input.type = 'text';
          input.value = set.name;
          const done = () => actions.rename(input.value.trim() || set.name);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') done();
          });
          nameBlock.replaceChildren(input, button('Save', 'btn', done));
          input.focus();
          input.select();
        }),
        copy,
        button('Export', 'btn', () => actions.exportRules()),
        button('Delete', 'btn danger', () => {
          if (actions.confirm(`Delete “${set.name}”? This cannot be undone — export it first if you might want it back.`)) {
            actions.remove();
          }
        })
      );
    } else {
      moreButtons.append(
        copy,
        button('Export', 'btn', () => actions.exportRules()),
        button('Remove', 'btn danger', () => {
          if (actions.confirm(`Remove the built-in rules for ${set.name}? You can restore them at the bottom of the list.`)) {
            actions.removeBuiltin();
          }
        })
      );
    }
    let tech = null;
    moreButtons.appendChild(button('Technical details', 'btn', () => {
      if (tech) {
        tech.remove();
        tech = null;
      } else {
        tech = technicalDetails(set, (parts) => actions.saveParts(parts));
        more.appendChild(tech);
      }
    }));
    more.appendChild(moreButtons);
    row.appendChild(more);
    return row;
  }

  /**
   * A site's card: every rule set for it, which one reads it, and the way back
   * to the built-in rules.
   *
   * siteActions: { resetToBuiltin(group) }
   */
  function siteGroupCard(group, actionsFor, siteActions, usableFor) {
    const used = group.sets.find((set) => set.id === group.defaultId) || group.sets[0];
    const card = el('div', `sitegroup${group.onThisPage ? ' here' : ''}`);
    card.dataset.help = 'rule-card';

    const head = el('div', 'sitegroup-head');
    const dot = paint(el('span', 'dot'), STATUS[statusOf(used)].color);
    dot.title = STATUS[statusOf(used)].label;
    const title = el('div', 'rulecard-name');
    title.append(el('strong', '', group.name), el('small', '', group.hosts.join(' · ')));
    head.append(dot, title);
    if (group.onThisPage) head.appendChild(tag('Open now', 'here'));
    card.appendChild(head);

    if (group.sets.filter((set) => !set.removed).length > 1) {
      card.appendChild(el('div', 'sitegroup-label', 'Which rules read this site — choose one:'));
    }
    for (const set of group.sets) {
      card.appendChild(setRow(set, group, actionsFor(set), { usable: usableFor(set) }));
    }
    if (group.builtin && !group.builtin.removed && group.defaultId !== group.builtin.id) {
      const reset = button('↺ Back to the built-in rules', 'btn', () => siteActions.resetToBuiltin(group),
        'Read this site with the rules the app came with again. Your own rule sets stay here.');
      reset.dataset.help = 'rules-reset';
      card.appendChild(reset);
    }
    return card;
  }

  /**
   * Fills the rule lists, one card per site: sites with rule sets of your own,
   * sites with only built-in rules, and built-in rules that were removed. The
   * site open right now comes first, because that is what someone fixing it is
   * looking for.
   */
  function renderSiteGroups(groups, hosts, filterText, actionsFor, siteActions, usableFor) {
    const filter = String(filterText || '').trim().toLowerCase();
    const matches = (group) =>
      !filter ||
      group.name.toLowerCase().includes(filter) ||
      group.hosts.some((h) => h.toLowerCase().includes(filter)) ||
      group.sets.some((set) => set.name.toLowerCase().includes(filter));
    const order = (a, b) => Number(Boolean(b.onThisPage)) - Number(Boolean(a.onThisPage));
    const fill = (host, list, empty) => {
      host.textContent = '';
      if (!list.length && empty) host.appendChild(el('div', 'empty', empty));
      for (const group of list) host.appendChild(siteGroupCard(group, actionsFor, siteActions, usableFor));
    };
    const live = groups.filter((group) => !group.removed && matches(group));
    const yours = live.filter((group) => group.sets.some((set) => set.origin === 'user'));
    const builtinOnly = live.filter((group) => !group.sets.some((set) => set.origin === 'user'));
    fill(hosts.user, yours.sort(order),
      filter ? 'None match.' : 'None yet. Open a chat and press “Teach this site”, or import rules from a file.');
    fill(hosts.builtins, builtinOnly.sort(order), 'None match.');
    const removed = groups.filter((group) => group.removed);
    fill(hosts.removed, removed, '');
    return removed.length;
  }

  /**
   * The quick switch on the "This site" card: which of the site's rule sets
   * reads it. Shown only when there is a choice to make.
   *
   * choices: [{ id, name, origin, isDefault }], from the site summary
   */
  function renderSiteSwitch(row, select, choices, onPick) {
    const list = choices || [];
    row.hidden = list.length < 2;
    select.textContent = '';
    for (const choice of list) {
      const option = el('option', '', choice.origin === 'builtin' ? `${choice.name} (built-in)` : choice.name);
      option.value = choice.id;
      option.selected = choice.isDefault;
      select.appendChild(option);
    }
    if (list.length && !list.some((choice) => choice.isDefault)) {
      // Nothing reads the site right now (its rules were turned off).
      const none = el('option', '', '— none —');
      none.value = '';
      none.selected = true;
      none.disabled = true;
      select.prepend(none);
    }
    select.onchange = () => {
      if (select.value) onPick(select.value);
    };
  }

  /* --------------------------------------------------------- the manual */

  /**
   * The manual viewer: contents on the left, the document on the right, and a
   * search that lists every section containing all the words typed.
   *
   * parts: { overlay, toc, content, search, close }
   * load:  async () => ({ html, toc }) — the rendered manual
   * openExternal: (url) => void, for web links in the manual
   */
  function createManualViewer({ overlay, toc, content, search, close }, load, openExternal) {
    let manual = null;

    function goTo(id) {
      const target = Array.from(content.querySelectorAll('[id]')).find((node) => node.id === id);
      if (!target) return;
      target.scrollIntoView({ block: 'start' });
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
    }

    function contents() {
      toc.textContent = '';
      for (const entry of manual.toc) {
        toc.appendChild(button(entry.text, entry.level === 3 ? 'sub' : '', () => goTo(entry.id)));
      }
    }

    function find(query) {
      if (!manual) return;
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) {
        contents();
        return;
      }
      toc.textContent = '';
      const headings = Array.from(content.querySelectorAll('h2[id], h3[id]'));
      let found = 0;
      for (const [i, heading] of headings.entries()) {
        let text = heading.textContent;
        for (let node = heading.nextElementSibling; node && node !== headings[i + 1]; node = node.nextElementSibling) {
          text += ' ' + node.textContent;
        }
        const lower = text.toLowerCase();
        if (!terms.every((t) => lower.includes(t))) continue;
        const at = lower.indexOf(terms[0]);
        const snippet = text.slice(Math.max(0, at - 40), at + 90).replace(/\s+/g, ' ').trim();
        const item = button('', 'result', () => goTo(heading.id));
        item.append(el('span', '', heading.textContent), el('small', '', `…${snippet}…`));
        toc.appendChild(item);
        found++;
      }
      if (!found) toc.appendChild(el('div', 'muted small', 'Nothing in the manual matches all of those words.'));
    }

    async function open(section) {
      overlay.hidden = false;
      if (!manual) {
        try {
          manual = await load();
        } catch (err) {
          content.textContent = `The manual could not be opened: ${err.message}`;
          return;
        }
        // The app's own document, rendered from docs/MANUAL.md.
        content.innerHTML = manual.html;
        contents();
      }
      if (section) goTo(section);
      else search.focus();
    }

    function hide() {
      overlay.hidden = true;
    }

    close.addEventListener('click', hide);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hide();
    });
    content.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href.startsWith('#')) goTo(decodeURIComponent(href.slice(1)));
      else if (/^https?:/i.test(href)) openExternal(href);
    });
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => find(search.value), 150);
    });

    return { open, hide, isOpen: () => !overlay.hidden };
  }

  /* ------------------------------------------------------ what's this? */

  /**
   * "What's this?" mode: while it is on, clicking anything with a `data-help`
   * key explains it instead of using it.
   *
   * parts: { toggleButton, bar, done, tip }
   * openManual: (section) => void
   */
  function createWhatsThis({ toggleButton, bar, done, tip }, openManual) {
    let on = false;

    function set(value) {
      on = value;
      document.body.classList.toggle('whats-this', on);
      bar.hidden = !on;
      toggleButton.classList.toggle('on', on);
      if (!on) tip.hidden = true;
    }

    function explain(target) {
      const topic = HelpLib.topic(target.dataset.help);
      tip.textContent = '';
      if (!topic) {
        tip.hidden = true;
        return;
      }
      tip.append(el('strong', '', topic.title), el('div', '', topic.text));
      tip.appendChild(button('Read more in the manual →', 'btn', () => {
        set(false);
        openManual(topic.section);
      }));
      tip.hidden = false;
      const r = target.getBoundingClientRect();
      const width = 300;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      const below = r.bottom + 8;
      tip.style.left = `${left}px`;
      tip.style.top = `${below}px`;
      const height = tip.getBoundingClientRect().height;
      if (below + height > window.innerHeight - 8) tip.style.top = `${Math.max(8, r.top - height - 8)}px`;
    }

    function intercept(e) {
      if (!on) return;
      if (e.target.closest && (e.target === toggleButton || bar.contains(e.target) || tip.contains(e.target) ||
          e.target.closest('.help-overlay'))) {
        return;
      }
      // In this mode a click explains a control instead of using it.
      e.preventDefault();
      e.stopPropagation();
      if (e.type !== 'click') return;
      const target = e.target.closest('[data-help]');
      if (target) explain(target);
      else tip.hidden = true;
    }

    for (const type of ['click', 'mousedown', 'pointerdown', 'dblclick']) {
      document.addEventListener(type, intercept, true);
    }
    toggleButton.addEventListener('click', () => set(!on));
    done.addEventListener('click', () => set(false));

    return { set, toggle: () => set(!on), isOn: () => on };
  }

  return {
    el,
    button,
    paint,
    tag,
    shortDate,
    statusOf,
    describeProblems,
    focusFor,
    healthLine,
    countsOf,
    partChips,
    renderLegend,
    renderReadStatus,
    setRow,
    siteGroupCard,
    renderSiteGroups,
    renderSiteSwitch,
    createManualViewer,
    createWhatsThis,
  };
});
