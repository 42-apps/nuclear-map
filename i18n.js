/* Local dictionaries also cover text inserted by the map and simulator. */
'use strict';

(function () {
  const languages = ['en', 'zh', 'ja', 'ko', 'fr'];
  const locales = { en: 'en', zh: 'zh-CN', ja: 'ja', ko: 'ko', fr: 'fr' };
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const originals = new WeakMap();
  const attributes = new WeakMap();
  const cache = new Map();
  const selector = document.getElementById('languageSel');
  const ignored = 'script,style,[data-i18n-ignore],.src-tag';
  const attributeNames = ['title', 'placeholder', 'aria-label', 'label', 'content'];
  const observerOptions = {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: attributeNames,
  };
  let language = 'en', dictionary = {}, patterns = [], phrases = new Map(), regions = null;
  let request = 0;
  const sentences = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;

  function translateKey(key) {
    let result = dictionary[key];
    if (result === undefined) {
      for (const pattern of patterns) {
        if (!key.includes(pattern.anchor)) continue;
        const match = pattern.regex.exec(key);
        if (!match) continue;
        result = pattern.target.replace(/98765\d{2}/g, slot => {
          const index = pattern.slots.indexOf(slot);
          const value = match[index + 1];
          const translated = translateKey(normalize(value));
          return translated === normalize(value) ? translatePhrases(value) : translated;
        });
        break;
      }
    }
    return result ?? key;
  }

  function translatePhrases(text) {
    const words = /[A-Za-z][A-Za-z0-9'-]*/g;
    let output = '', copied = 0, match;
    while ((match = words.exec(text))) {
      const candidates = phrases.get(match[0].toLowerCase());
      if (!candidates) continue;
      for (const phrase of candidates) {
        const end = match.index + phrase.source.length;
        if (text.slice(match.index, end).toLowerCase() !== phrase.source) continue;
        if (/[a-z0-9]$/i.test(phrase.source) && /[a-z0-9]/i.test(text.charAt(end))) continue;
        output += text.slice(copied, match.index) + phrase.target;
        copied = end; words.lastIndex = end;
        break;
      }
    }
    return output + text.slice(copied);
  }

  function translate(text) {
    if (language === 'en' || !text) return text;
    const key = normalize(String(text));
    let result = translateKey(key);
    if (result === key) {
      const parts = key.split(/( · | — |, )/);
      if (parts.length > 1) result = parts.map((part, i) => {
        if (i % 2) return part;
        const translated = translateKey(part);
        return translated === part ? translatePhrases(part) : translated;
      }).join('');
    }
    if (result === key && sentences) {
      const parts = [...sentences.segment(key)].map(part => {
        const source = normalize(part.segment);
        const translated = translateKey(source);
        return translated === source ? translatePhrases(source) : translated;
      });
      if (parts.length > 1) result = parts.join(' ');
    }
    if (result === key) result = translatePhrases(key);
    if (result === key) return text;
    const before = String(text).match(/^\s*/)[0], after = String(text).match(/\s*$/)[0];
    return before + result + after;
  }

  function localizeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.parentElement || node.parentElement.closest(ignored)) return;
      const previous = originals.get(node);
      const source = previous && node.nodeValue === previous.rendered ? previous.source : node.nodeValue;
      const rendered = translate(source);
      originals.set(node, { source, rendered });
      if (node.nodeValue !== rendered) node.nodeValue = rendered;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.closest(ignored)) return;
      let saved = attributes.get(node);
      if (!saved) { saved = {}; attributes.set(node, saved); }
      for (const name of attributeNames) {
        if (!node.hasAttribute(name)) continue;
        if (name === 'content' && !['description', 'og:title', 'og:description', 'twitter:title', 'twitter:description']
          .includes(node.getAttribute('name') || node.getAttribute('property'))) continue;
        const current = node.getAttribute(name), previous = saved[name];
        const source = previous && current === previous.rendered ? previous.source : current;
        const rendered = translate(source);
        saved[name] = { source, rendered };
        if (current !== rendered) node.setAttribute(name, rendered);
      }
    }
    for (const child of node.childNodes) localizeNode(child);
  }

  const observer = new MutationObserver(mutations => {
    observer.disconnect();
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) localizeNode(node);
      } else localizeNode(mutation.target);
    }
    observer.observe(document.documentElement, observerOptions);
  });

  function refresh() {
    observer.disconnect();
    localizeNode(document);
    observer.observe(document.documentElement, observerOptions);
  }

  function compilePatterns(values) {
    return Object.entries(values).filter(([source, target]) =>
      /98765\d{2}/.test(source) && /[a-zA-Z]/.test(source) &&
      (source.match(/98765\d{2}/g) || []).every(slot => target.includes(slot) ||
        (slot === '9876501' && source.includes('mapped site9876501'))))
      .map(([source, target]) => {
        const slots = source.match(/98765\d{2}/g);
        const fragments = source.split(/98765\d{2}/);
        const numericUnit = /^98765\d{2}\s?(?:m|M|k|km|Mt|kt|bn|mph|min|psi)$/.test(source);
        return {
          slots, target,
          anchor: fragments.reduce((longest, fragment) => fragment.length > longest.length ? fragment : longest, ''),
          weight: source.replace(/98765\d{2}/g, '').length,
          regex: source === '9876500 in 9876501'
            ? /^([\d,.]+) in (\d{4})$/
            : new RegExp('^' + fragments.map(escapeRegex).join(numericUnit
              ? '([-+\\d,.]+(?:[–-][\\d,.]+)?)' : '(.{1,600}?)') + '$'),
        };
      }).sort((a, b) => b.weight - a.weight);
  }

  async function setLanguage(next, persist = true) {
    if (!languages.includes(next)) next = 'en';
    const id = ++request;
    selector.disabled = true;
    selector.setAttribute('aria-busy', 'true');
    try {
      let values = {};
      if (next !== 'en') {
        if (!cache.has(next)) {
          const response = await fetch('data/i18n/' + next + '.json?v=0128');
          if (!response.ok) throw new Error('Language file: HTTP ' + response.status);
          cache.set(next, await response.json());
        }
        values = cache.get(next);
      }
      if (id !== request) return;
      language = next; dictionary = values; patterns = compilePatterns(values);
      phrases = new Map();
      for (const [source, target] of Object.entries(values)) {
        if (/98765\d{2}/.test(source)) continue;
        const first = source.match(/^[A-Za-z][A-Za-z0-9'-]*/);
        if (!first || source.length === 1 || source.toLowerCase() === target.toLowerCase()) continue;
        const key = first[0].toLowerCase();
        if (!phrases.has(key)) phrases.set(key, []);
        phrases.get(key).push({ source: source.toLowerCase(), target });
      }
      for (const entries of phrases.values()) entries.sort((a, b) => b.source.length - a.source.length);
      regions = next !== 'en' && typeof Intl.DisplayNames === 'function'
        ? new Intl.DisplayNames([locales[next]], { type: 'region' }) : null;
      document.documentElement.lang = locales[next];
      selector.value = next;
      if (persist) {
        try { localStorage.setItem('nk_language', next); } catch (error) { /* Storage may be disabled. */ }
      }
      window.dispatchEvent(new CustomEvent('nuke:languagechange', { detail: { language: next } }));
      refresh();
    } catch (error) {
      console.error(error);
      selector.value = language;
      if (window.NukeApp) window.NukeApp.showToast(translate('Could not load this language. Please try again.'));
    } finally {
      if (id === request) {
        selector.disabled = false;
        selector.removeAttribute('aria-busy');
      }
    }
  }

  window.NukeI18n = {
    get language() { return language; },
    t: translate, setLanguage, refresh,
    countryName(iso, a2, fallback) {
      if (language === 'en') return fallback;
      if (language === 'zh' && iso === 'TWN') return '中国台湾';
      if (regions && /^[a-z]{2}$/i.test(a2 || '')) {
        try { return regions.of(a2.toUpperCase()) || translate(fallback); } catch (error) { /* Use the dictionary. */ }
      }
      return translate(fallback);
    },
  };
  selector.addEventListener('change', () => setLanguage(selector.value));
  observer.observe(document.documentElement, observerOptions);
  let saved = 'en';
  try { saved = localStorage.getItem('nk_language') || 'en'; } catch (error) { /* English is the default. */ }
  if (saved !== 'en') setLanguage(saved, false);
})();
