const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(children = [], ignored = false) {
    this.nodeType = 1; this.childNodes = children; this.attributes = new Map(); this.ignored = ignored;
    for (const child of children) child.parentElement = this;
  }
  closest() { return this.ignored ? this : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener() {}
}
const text = value => ({ nodeType: 3, nodeValue: value });
const heading = text('Global Nuclear Weapons Map');
const paragraph = text('Nine countries. Around twelve thousand warheads. Here is where they are.');
const originalParagraph = paragraph.nodeValue;
const source = text('Federation of American Scientists');
const input = new Element();
input.setAttribute('placeholder', 'Search a country, site or city…');
const selector = new Element();
selector.setAttribute('title', 'Language');
const html = new Element([new Element([heading, paragraph]), new Element([source], true), input, selector]);
const document = { nodeType: 9, childNodes: [html], documentElement: html, getElementById: () => selector };
const storage = new Map();
const changes = [];
let callback;
const root = path.resolve(__dirname, '..');
const context = {
  document, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_NODE: 9 }, Intl, console,
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  MutationObserver: class { constructor(fn) { callback = fn; } disconnect() {} observe() {} },
  CustomEvent: class { constructor(type, data) { this.type = type; this.detail = data.detail; } },
  fetch: async url => ({
    ok: true,
    json: async () => JSON.parse(fs.readFileSync(path.join(root, url.split('?')[0]), 'utf8')),
  }),
};
context.window = context;
context.dispatchEvent = event => changes.push(event.detail.language);
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'i18n.js'), 'utf8'), context);

(async () => {
  const api = context.NukeI18n;
  assert.equal(api.language, 'en');
  assert.equal(heading.nodeValue, 'Global Nuclear Weapons Map');
  for (const language of ['zh', 'ja', 'ko', 'fr']) {
    await api.setLanguage(language);
    assert.equal(api.language, language);
    assert.notEqual(heading.nodeValue, 'Global Nuclear Weapons Map');
    assert.notEqual(paragraph.nodeValue, originalParagraph);
    assert.equal(source.nodeValue, 'Federation of American Scientists');
    assert.notEqual(input.getAttribute('placeholder'), 'Search a country, site or city…');
    assert.notEqual(selector.getAttribute('title'), undefined);
    const dynamic = api.t('1,234 nuclear states');
    assert(dynamic.includes('1,234'), 'Dynamic values must not change');
    assert(!dynamic.includes('nuclear states'), 'Dynamic labels must be translated');
    assert(!api.t('1945 — Trinity: the first nuclear explosion').includes('first nuclear explosion'));
    assert(!api.t('W78 warhead, W87-0 warhead').includes('warhead'));
    assert(api.t('123–360 Mt').includes('123–360'));
    assert(!api.t('123–360 Mt').includes('山'), 'Mt is megatons, not mountains');
    assert(!api.t('Windows break').includes('Windows'), 'Windows means glass, not software');
    assert(!api.t('776 m').includes(' M'), 'Metres must not become millions');
    assert(!api.t('1980 — A 46-cent computer chip fakes a Soviet attack').includes('computer chip'));
    assert(!api.t('DF-26 IRBM').includes('IRBM'), 'Generic model descriptions must still be translated');
    assert(!api.t('W88 — 455 kt').includes('kt') || language === 'fr');
    assert(!api.t('View 35.5 km across · click the map to move ground zero').includes('km') || language === 'fr');
    assert.equal(storage.get('nk_language'), language);
    assert.equal(selector.disabled, false);
    heading.nodeValue = 'Nuclear status';
    callback([{ type: 'characterData', target: heading }]);
    assert.notEqual(heading.nodeValue, 'Nuclear status', 'New dynamic text must be localized');
    await api.setLanguage('en');
    assert.equal(heading.nodeValue, 'Nuclear status');
    assert.equal(paragraph.nodeValue, originalParagraph);
    assert.equal(input.getAttribute('placeholder'), 'Search a country, site or city…');
    heading.nodeValue = 'Global Nuclear Weapons Map';
    callback([{ type: 'characterData', target: heading }]);
  }
  await api.setLanguage('zh');
  assert.equal(api.countryName('CHN', 'CN', 'China'), '中国');
  assert.equal(api.countryName('TWN', 'TW', 'Taiwan'), '中国台湾');
  await api.setLanguage('unsupported');
  assert.equal(api.language, 'en');
  assert.equal(api.countryName('CHN', 'CN', 'China'), 'China');
  console.log('PASS: four languages, dynamic text, values, source exemptions, English restoration, persistence and country names');
  console.log('Language changes:', changes.join(' -> '));
})().catch(error => { console.error(error); process.exitCode = 1; });
