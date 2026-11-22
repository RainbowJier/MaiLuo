<template>
  <aside class="sidebar">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="#D97757" stroke-width="2.2" stroke-linecap="round">
        <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>
      </svg>
      <span class="logo-name serif">MaiLuo</span>
    </div>

    <div class="project-card" title="点击配置项目" @click="S.configOpen = true">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M2.5 5.5c0-.6.4-1 1-1h4l1.5 2h7.5c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1h-13c-.6 0-1-.4-1-1v-9z"/>
      </svg>
      <div style="min-width:0">
        <p class="project-name">{{ projectName }}</p>
        <p class="project-path">{{ S.config.root || '未配置项目' }}</p>
      </div>
    </div>

    <div class="sidebar-divider"></div>

    <div class="groups-head">
      <span class="groups-title">分组</span>
      <button class="g-btn" title="新建分组" @click="createRoot">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>
      </button>
    </div>

    <nav class="nav groups">
      <div v-if="!S.config.root" class="empty-hint">请先点击上方项目卡片<br/>配置项目根路径</div>
      <div v-else-if="!rootGroups.length" class="empty-hint">暂无分组<br/>点击右上 + 新建<br/>支持嵌套子分组</div>
      <template v-else>
        <template v-for="row in rows" :key="row.type + '|' + row.g.id + '|' + (row.rel || '')">
          <!-- 分组行 -->
          <div v-if="row.type === 'group'" class="group-row"
               :class="{ drop: dropId === row.g.id }"
               :style="{ paddingLeft: 8 + row.depth * 14 + 'px' }"
               @click="toggleCollapse(row.g.id)"
               @dragover.prevent="dropId = row.g.id"
               @dragleave="dropId === row.g.id && (dropId = null)"
               @drop.prevent="onDrop(row.g, $event)">
            <span class="g-chevron" :class="{ open: !collapsed.has(row.g.id) }">
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 2.5L8 6l-4 3.5"/></svg>
            </span>
            <svg class="g-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.5 1.5h2.5l1 1.5h3.5v7h-7v-8.5z"/></svg>
            <input v-if="renaming === row.g.id" :ref="setRenameInput" v-model="renameText" class="g-rename"
                   @click.stop @keydown.enter="commitRename(row.g.id)" @keydown.esc="renaming = null"
                   @blur="commitRename(row.g.id)" />
            <span v-else class="g-name" :title="row.g.name">{{ row.g.name }}</span>
            <span class="g-actions" @click.stop>
              <button class="g-btn" title="新建子分组" @click="createChild(row.g)">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>
              </button>
              <button class="g-btn" title="添加组件" @click="openPicker(row.g)">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 4.5h2.5l1 1.5h7.5v6.5h-11v-8z"/></svg>
              </button>
              <button class="g-btn" title="重命名" @click="beginRename(row.g.id, row.g.name)">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.3 2.7l2 2-8 8-2.9.9.9-2.9 8-8z"/></svg>
              </button>
              <button class="g-btn danger" title="删除分组" @click="removeGroup(row.g)">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
              </button>
            </span>
          </div>
          <!-- 分组内文件 -->
          <div v-else class="group-file"
               :class="{ active: row.rel === S.selectedFile }"
               :style="{ paddingLeft: 26 + row.depth * 14 + 'px' }"
               :title="row.rel"
               @click="selectFile(row.rel)">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1.5A.5.5 0 0 1 3.5 1h4l1.5 1.5H13a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5H3.5a.5.5 0 0 1-.5-.5v-12z"/></svg>
            <span>{{ fileName(row.rel) }}</span>
            <button class="g-btn g-unlink" title="移出分组" @click.stop="unlink(row.g, row.rel)">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
          </div>
        </template>
      </template>
    </nav>

    <!-- 组件选择弹窗 -->
    <div v-if="pickGroup" class="modal-overlay" @click.self="closePicker">
      <div class="modal pick-modal">
        <div class="modal-header">
          <h2>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2.5 5.5c0-.6.4-1 1-1h4l1.5 2h7.5c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1h-13c-.6 0-1-.4-1-1v-9z"/>
            </svg>
            选择组件 · {{ pickGroup.name }}
          </h2>
          <button class="modal-close" @click="closePicker">✕</button>
        </div>
        <div class="modal-body">
          <div class="pick-search">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            <input v-model="pickKw" type="text" placeholder="搜索组件…" />
          </div>
          <div class="pick-list">
            <div v-for="f in pickFiles" :key="f.rel" class="pick-item"
                 :class="{ on: pickSel.has(f.rel) }" :title="f.rel" @click="togglePick(f.rel)">
              <span class="pick-check">
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5l2.5 2.5L10 3.5"/></svg>
              </span>
              <span class="pick-path">{{ f.name }}</span>
            </div>
            <div v-if="!pickFiles.length" class="pick-empty">无匹配组件</div>
          </div>
        </div>
        <div class="modal-footer">
          <span class="pick-count">已选 {{ pickSel.size }} 个</span>
          <button class="btn-ghost" @click="closePicker">取消</button>
          <button class="btn-primary" style="padding:9px 22px" @click="confirmPick">确定</button>
        </div>
      </div>
    </div>

    <div class="sidebar-footer">
      <div class="user-info">
        <div class="avatar">F</div>
        <div>
          <p class="user-name">Frank</p>
          <p class="user-status" :class="{ bad: !S.claudeOk }">
            {{ S.claudeOk ? `Claude Code ${S.claudeVersion.split(' ')[0]}` : 'Claude 未检测到' }}
          </p>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import {
  S, selectFile, fileName, showToast,
  addGroup, renameGroup, deleteGroup,
  addFileToGroup, removeFileFromGroup, setGroupFiles, groupsForRoot
} from '../store.js';

const projectName = computed(() =>
  S.config.root ? S.config.root.split(/[\\/]/).filter(Boolean).pop() : '未配置');
const rootGroups = computed(() => groupsForRoot());
const fileByRel = computed(() => Object.fromEntries(S.files.map(f => [f.rel, f])));

const collapsed = reactive(new Set());
const dropId = ref(null);
const renaming = ref(null);
const renameText = ref('');
const pickerFor = ref(null);
const pickKw = ref('');
const pickSel = reactive(new Set());

const rows = computed(() => {
  const out = [];
  const walk = (nodes, depth) => {
    for (const g of nodes) {
      out.push({ type: 'group', g, depth });
      if (collapsed.has(g.id)) continue;
      for (const rel of g.files || []) {
        if (fileByRel.value[rel]) out.push({ type: 'file', g, rel, depth });
      }
      walk(g.children || [], depth + 1);
    }
  };
  walk(rootGroups.value, 0);
  return out;
});

/* ---------------- 组件选择弹窗 ---------------- */
const pickGroup = computed(() => {
  if (!pickerFor.value) return null;
  const find = (nodes) => {
    for (const g of nodes) {
      if (g.id === pickerFor.value) return g;
      const hit = find(g.children || []);
      if (hit) return hit;
    }
    return null;
  };
  return find(rootGroups.value);
});
const pickFiles = computed(() => {
  const kw = pickKw.value.trim().toLowerCase();
  return S.files.filter(f => !kw || f.rel.toLowerCase().includes(kw));
});

function openPicker(g) {
  pickerFor.value = g.id;
  pickKw.value = '';
  pickSel.clear();
  for (const rel of g.files || []) { if (fileByRel.value[rel]) pickSel.add(rel); }
}
function closePicker() { pickerFor.value = null; }
function togglePick(rel) {
  pickSel.has(rel) ? pickSel.delete(rel) : pickSel.add(rel);
}
function confirmPick() {
  if (pickerFor.value) setGroupFiles(pickerFor.value, [...pickSel]);
  closePicker();
}

function setRenameInput(el) {
  if (el) { el.focus(); el.select(); }
}

function toggleCollapse(id) {
  collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
}
function beginRename(id, current) {
  renameText.value = current;
  renaming.value = id;
}
function commitRename(id) {
  if (renaming.value !== id) return;
  renameGroup(id, renameText.value);
  renaming.value = null;
}
function createRoot() {
  if (!S.config.root) { S.configOpen = true; showToast('请先配置项目根路径'); return; }
  const id = addGroup(null);
  if (id) beginRename(id, '新建分组');
}
function createChild(g) {
  const id = addGroup(g.id);
  if (id) {
    collapsed.delete(g.id);
    beginRename(id, '新建分组');
  }
}
function removeGroup(g) {
  if (window.confirm(`删除分组「${g.name}」？\n其子分组将一并删除（组件文件本身不受影响）。`)) {
    deleteGroup(g.id);
  }
}
function unlink(g, rel) {
  removeFileFromGroup(g.id, rel);
}
function onDrop(g, ev) {
  dropId.value = null;
  const rel = ev.dataTransfer.getData('text/mailuo-rel') || ev.dataTransfer.getData('text/plain');
  if (rel && fileByRel.value[rel]) {
    collapsed.delete(g.id);
    addFileToGroup(g.id, rel);
  }
}
</script>
