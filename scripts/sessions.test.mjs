import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeSessions, componentRel, componentSessionKey } from '../src/session-key.js';

test('componentRel strips the configured frontend prefix and tolerates backslashes', () => {
  assert.equal(componentRel('frontend/src/views/Order.vue', 'frontend'), 'src/views/Order.vue');
  assert.equal(componentRel('src\\views\\Order.vue', 'frontend'), 'src/views/Order.vue');
  assert.equal(componentRel('frontend/src/views/Order.vue', ''), 'frontend/src/views/Order.vue');
});

test('componentSessionKey is stable and bounded for long paths', () => {
  assert.equal(componentSessionKey('src/views/Order.vue'), 'vue:src/views/Order.vue');
  const long = `src/views/${'nested/'.repeat(40)}Order.vue`;
  const key = componentSessionKey(long);
  assert.match(key, /^vue:h[0-9a-z]+$/);
  assert.equal(componentSessionKey(long), key);
  assert.ok(key.length <= 100);
});

test('load-time cleanup drops global sessions and merges duplicates per component', () => {
  const list = [
    { id: 1, name: '会话 1', file: '', claudeKey: 'analysis-1', projectRoot: 'D:/p' },
    { id: 2, name: '会话 2', file: 'frontend/src/views/Order.vue', claudeKey: 'analysis-2', projectRoot: 'd:\\p' },
    { id: 3, name: 'Order.vue', file: 'frontend/src/views/Order.vue', claudeKey: 'analysis-3',
      projectRoot: 'D:/p', analyzed: true, data: { functions: [{ id: 'list' }] }, status: 'done' },
    { id: 4, name: 'User.vue', file: 'frontend/src/views/User.vue', claudeKey: 'analysis-4', projectRoot: 'D:/p' }
  ];
  const chatWeight = s => (s.id === 2 ? 9 : s.id === 3 ? 2 : 0);
  const result = canonicalizeSessions(list, { frontend: 'frontend', root: 'D:/p', activeId: 2, chatWeight });
  assert.equal(result.sessions.length, 2);
  const order = result.sessions.find(s => s.file.endsWith('Order.vue'));
  assert.equal(order.id, 2, 'keeps the first session id for pointer stability');
  assert.equal(order.name, 'Order.vue', 'names the session after the Vue menu component');
  assert.equal(order.file, 'frontend/src/views/Order.vue');
  assert.equal(order.claudeKey, 'analysis-2', 'keeps the chat with the longest history');
  assert.equal(order.analyzed, true, 'keeps the available analysis result');
  assert.deepEqual(order.data, { functions: [{ id: 'list' }] });
  assert.equal(order.status, 'done');
  assert.equal(result.activeId, 2);
  assert.equal(result.sessions.find(s => s.file.endsWith('User.vue')).id, 4);
});

test('an active duplicate session is remapped to the merged component session', () => {
  const result = canonicalizeSessions([
    { id: 5, file: 'frontend/src/views/A.vue', projectRoot: 'D:/p' },
    { id: 6, file: 'frontend/src/views/A.vue', projectRoot: 'D:/p', analyzed: true, data: { functions: [] } }
  ], { frontend: 'frontend', root: 'D:/p', activeId: 6 });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.activeId, 5);
  assert.equal(result.sessions[0].analyzed, true);
});

test('the same component in different projects stays as two independent sessions', () => {
  const result = canonicalizeSessions([
    { id: 1, file: 'frontend/src/views/Order.vue', projectRoot: 'D:/a' },
    { id: 2, file: 'frontend/src/views/Order.vue', projectRoot: 'D:/b' }
  ], { frontend: 'frontend', root: 'D:/a' });
  assert.equal(result.sessions.length, 2);
  assert.deepEqual(result.sessions.map(s => s.id), [1, 2]);
});

test('an activeId whose session disappeared falls back to the first remaining session', () => {
  const result = canonicalizeSessions([
    { id: 1, file: '', claudeKey: 'analysis-1', projectRoot: 'D:/p' },
    { id: 2, file: 'frontend/src/views/A.vue', projectRoot: 'D:/p' }
  ], { frontend: 'frontend', root: 'D:/p', activeId: 1 });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.activeId, 2);
});

test('sessions of the current project are re-based onto the configured frontend dir', () => {
  const result = canonicalizeSessions([
    { id: 1, file: 'frontend\\src\\views\\A.vue', projectRoot: 'D:\\p' }
  ], { frontend: 'frontend\\src\\views', root: 'D:/p' });
  assert.equal(result.sessions[0].file, 'frontend/src/views/A.vue');
  assert.equal(result.sessions[0].name, 'A.vue');
});

test('sessions of another project are never re-prefixed with the current frontend dir', () => {
  // file 是相对「它自己项目」的前端目录记录的。用当前项目的前端配置去重拼，每次启动都会把
  // 别人的路径越拼越长（web/src/… → frontend/src/views/web/src/…），而且会被存回磁盘。
  const stored = { id: 7, file: 'web/src/views/Login.vue', projectRoot: 'D:/other', analyzed: true, data: { functions: [{ id: 'a' }] } };
  let file = stored.file;
  for (const frontend of ['frontend', 'frontend/src/views', 'admin']) {   // 在不同项目配置下来回启动
    const result = canonicalizeSessions([{ ...stored, file }], { frontend, root: 'D:/current' });
    file = result.sessions[0].file;
  }
  assert.equal(file, 'web/src/views/Login.vue');
  assert.equal(canonicalizeSessions([{ ...stored, file: 'web\\src\\views\\Login.vue' }], { frontend: 'frontend', root: 'D:/current' })
    .sessions[0].file, 'web/src/views/Login.vue', 'only separators are normalized');
});
