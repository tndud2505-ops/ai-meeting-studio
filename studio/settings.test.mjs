import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, answerStyleRule, DEFAULT_SETTINGS } from './settings.mjs';

test('settings are clamped to safe values', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  const s = sanitizeSettings({ fontScale: 999, answerStyle: 'evil', showTime: 'yes', autoScroll: false });
  assert.equal(s.fontScale, 150);
  assert.equal(s.answerStyle, 'brief');
  assert.equal(s.showTime, true);
  assert.equal(s.autoScroll, false);
  assert.equal(sanitizeSettings({ fontScale: 12 }).fontScale, 85);
  assert.equal(sanitizeSettings({ fontScale: 103 }).fontScale, 105);
});

test('answer style rule: brief and detailed add rules, normal adds none', () => {
  assert.match(answerStyleRule('brief'), /핵심만/);
  assert.match(answerStyleRule('brief', 'project'), /최종 보고/);
  assert.match(answerStyleRule('detailed'), /자세히/);
  assert.equal(answerStyleRule('normal'), '');
});
