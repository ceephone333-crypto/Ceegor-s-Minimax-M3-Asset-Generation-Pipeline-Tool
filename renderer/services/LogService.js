// renderer/services/LogService.js
// Bounded Ring-Buffer für Log-Events. Lauscht auf `mmx:log` vom EventBus
// und emittiert `log:appended` für UI-Konsumenten (PreviewPanel etc.).
// Ersetzt die `_logEvents`-Property in app.js inkrementell.

const MAX_EVENTS = 5000;
const events = [];
let nextId = 1;
let unsubscribe = null;

function append(event) {
  const e = Object.assign({ id: nextId++, time: Date.now() }, event);
  events.push(e);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  if (window.EventBus) window.EventBus.emit('log:appended', e);
  return e;
}

function list() { return events.slice(); }

function clear() {
  events.length = 0;
  if (window.EventBus) window.EventBus.emit('log:cleared', null);
}

function attachMmxStream() {
  if (!window.EventBus) return () => {};
  return window.EventBus.on('mmx:log', (line) => {
    append({ source: 'mmx', level: 'info', text: String(line) });
  });
}

function init() {
  if (unsubscribe) return; // idempotent
  unsubscribe = attachMmxStream();
}

window.LogService = { init, append, list, clear, MAX_EVENTS };
