// jsdom reports en-US as the device language; the unit suites assert German texts, so the
// language preference is pinned before any module reads it (T6.6). Tests for the language
// store itself override localStorage explicitly.
window.localStorage.setItem('lfc.language', 'de');
