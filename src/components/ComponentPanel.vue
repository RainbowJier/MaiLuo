<template>
  <section class="component-panel">
    <div class="panel-header">
      <h2>Vue 组件</h2>
    </div>
    <div class="search-box">
      <input v-model="kw" type="text" placeholder="搜索组件…" />
    </div>
    <div class="file-tree">
      <template v-if="!S.config.root">
        <div class="empty-hint">请先点击左上角项目卡片<br/>配置项目根路径</div>
      </template>
      <template v-else-if="!filtered.length">
        <div class="empty-hint">{{ S.files.length ? '无匹配组件' : '前端目录下未找到 .vue 文件' }}</div>
      </template>
      <template v-for="(group, dir) in grouped" :key="dir">
        <div class="tree-folder">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.5 1.5h2.5l1 1.5h3.5v7h-7v-8.5z"/></svg>
          {{ dir }} /
        </div>
        <div v-for="f in group" :key="f.rel" class="tree-file"
             :class="{ active: f.rel === S.selectedFile }"
             @click="selectFile(f.rel)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1.5A.5.5 0 0 1 3.5 1h4l1.5 1.5H13a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5H3.5a.5.5 0 0 1-.5-.5v-12z"/></svg>
          <span>{{ f.name }}</span>
          <span v-if="S.fileApiCount[f.rel]" class="api-count">{{ S.fileApiCount[f.rel] }} API</span>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup>
import { ref, computed } from 'vue';
import { S, selectFile } from '../store.js';

const kw = ref('');
const filtered = computed(() =>
  !kw.value ? S.files : S.files.filter(f => f.rel.toLowerCase().includes(kw.value.toLowerCase())));
const grouped = computed(() => {
  const g = {};
  for (const f of filtered.value) (g[f.dir] = g[f.dir] || []).push(f);
  return g;
});
</script>
