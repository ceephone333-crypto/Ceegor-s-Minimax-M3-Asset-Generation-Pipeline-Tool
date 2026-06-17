// tests/unit/renderer/core/EventBus.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../../../../renderer/core/EventBus.js');
const { on, off, emit } = window.EventBus;

test('emit fires registered handler with payload', () => {
  let received = null;
  const off = on('test:ping', (p) => { received = p; });
  emit('test:ping', { x: 42 });
  assert.deepEqual(received, { x: 42 });
  off();
});

test('on returns an unsubscribe function', () => {
  let count = 0;
  const unsub = on('test:counter', () => count++);
  emit('test:counter', null);
  emit('test:counter', null);
  assert.equal(count, 2);
  unsub();
  emit('test:counter', null);
  assert.equal(count, 2);
});

test('off detaches the handler', () => {
  let count = 0;
  const handler = () => count++;
  on('test:off', handler);
  emit('test:off', null);
  off('test:off', handler);
  emit('test:off', null);
  assert.equal(count, 1);
});

test('emit with no listeners is a no-op', () => {
  // Should not throw
  emit('test:nobody', null);
  emit('test:nobody', { a: 1 });
});

test('handler exception does not stop other handlers', () => {
  let count = 0;
  on('test:multi', () => { throw new Error('boom'); });
  on('test:multi', () => { count++; });
  emit('test:multi', null);
  assert.equal(count, 1);
});

test('multiple handlers on same event all fire', () => {
  let count = 0;
  on('test:broadcast', () => count++);
  on('test:broadcast', () => count++);
  on('test:broadcast', () => count++);
  emit('test:broadcast', null);
  assert.equal(count, 3);
});
