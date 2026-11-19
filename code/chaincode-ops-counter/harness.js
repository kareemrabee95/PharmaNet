'use strict';
// In-memory ledger that mimics the Fabric chaincode stub, with operation counters.
const SEP = '\u0000';
function makeLedger() {
  const state = new Map();
  const c = { getState: 0, putState: 0, iterOpen: 0, iterNext: 0, jsonParse: 0 };
  const origParse = JSON.parse;
  const stub = {
    createCompositeKey: (t, a) => SEP + t + SEP + a.map(x => x + SEP).join(''),
    async getState(k) { c.getState++; return state.has(k) ? Buffer.from(state.get(k)) : Buffer.alloc(0); },
    async putState(k, v) { c.putState++; state.set(k, v.toString()); },
    _iter(keys) {
      c.iterOpen++;
      let i = 0;
      return {
        async next() {
          c.iterNext++;
          if (i >= keys.length) return { value: undefined, done: true };
          const k = keys[i++];
          return { value: { key: k, value: Buffer.from(state.get(k)) }, done: false };
        },
        async close() {}
      };
    },
    async getStateByPartialCompositeKey(t, attrs) {
      const prefix = SEP + t + SEP + attrs.map(x => x + SEP).join('');
      const keys = [...state.keys()].filter(k => k.startsWith(prefix)).sort();
      return stub._iter(keys);
    },
    async getStateByRange(s, e) {
      const keys = [...state.keys()].filter(k => k >= s && k <= e).sort();
      return stub._iter(keys);
    }
  };
  JSON.parse = function (...a) { c.jsonParse++; return origParse.apply(this, a); };
  const reset = () => { for (const k of Object.keys(c)) c[k] = 0; };
  return { state, stub, c, reset, restore: () => { JSON.parse = origParse; } };
}
module.exports = { makeLedger, SEP };
