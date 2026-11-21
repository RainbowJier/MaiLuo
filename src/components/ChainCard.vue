<template>
  <div class="chain-item" :class="{ expanded }">
    <div class="chain-header" @click="$emit('focus', fn.id)">
      <span class="method" :class="fn.method">{{ fn.method.toUpperCase() }}</span>
      <span class="fn-name">{{ fn.name }}</span>
      <span class="path">{{ fn.url }}</span>
      <span class="tag" :class="fn.tag[0]">{{ fn.tag[1] }}</span>
    </div>
    <div class="chain-desc">{{ fn.desc }}</div>

    <!-- 请求参数 -->
    <div v-if="paramGroups.length" class="params-box">
      <div class="params-title">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6.5 3.5L3 8l3.5 4.5M9.5 3.5L13 8l-3.5 4.5"/></svg>
        请求参数
      </div>
      <template v-for="[kind, label] in paramGroups" :key="kind">
        <div class="params-title"><span class="params-kind" :class="kind">{{ label }}</span></div>
        <div v-for="it in fn.params[kind]" :key="it.name" class="param-row">
          <code class="param-name">{{ it.name }}</code>
          <span class="param-type">{{ it.type }}</span>
          <span class="param-req" :class="it.req ? 'must' : 'opt'">{{ it.req ? '必填' : '可选' }}</span>
          <span class="param-desc">{{ it.desc }}</span>
        </div>
      </template>
    </div>

    <!-- o---o 链路条 -->
    <div class="bar">
      <template v-for="(s2, i) in all" :key="i">
        <span class="bar-node" :class="s2.t === 'http' ? `http ${fn.method}` : s2.t"
              :title="`${BAR_TITLE[s2.t] || '逻辑点'}：${s2.n}${s2.where ? '（' + s2.where + '）' : ''}`">
          {{ BAR_LETTER[s2.t] || String(i - fn.front.length + 1) }}
        </span>
        <span v-if="i < all.length - 1" class="bar-link"></span>
      </template>
    </div>
    <div class="bar-caption">{{ all.map(s2 => s2.n.split('(')[0]).join(' → ') }}</div>

    <!-- 展开明细 -->
    <div class="chain-detail">
      <div class="detail-steps">
        <div v-for="(s2, i) in all" :key="i" class="step-row" :class="{ branched: s2.branch }">
          <span class="step-idx">{{ i + 1 }}</span>
          <div class="step-body">
            <span class="step-name">
              {{ s2.n }}
              <span v-if="s2.tx === 'begin'" class="tx-badge">@Transactional 开启</span>
              <span v-else-if="s2.tx === 'in'" class="tx-badge">事务内</span>
            </span>
            <span class="step-loc">{{ s2.s || s2.where }}</span>
          </div>
        </div>
        <div v-for="(t, i) in fn.branchText" :key="'b' + i"
             :class="t.startsWith('✓') ? 'branch-condition' : 'branch-condition-fail'"
             :style="t.startsWith('✓') ? '' : 'display:block'">{{ t }}</div>
      </div>
    </div>

    <div class="chain-footer">
      <button class="btn-text" @click="expanded = !expanded">{{ expanded ? '收起详情 ▴' : '展开详情 ▾' }}</button>
      <span class="toggle-hint">点击头部可在图中聚焦此功能</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { seq, BAR_LETTER, BAR_TITLE } from '../chain.js';
import { selectFn } from '../store.js';

const props = defineProps({ fn: Object });
defineEmits({ focus: id => { selectFn(id); return true; } });

const expanded = ref(false);
const all = computed(() => seq(props.fn));
const paramGroups = computed(() => {
  const p = props.fn.params || {};
  return [['path', 'Path'], ['query', 'Query'], ['body', 'Body · JSON']]
    .filter(([k]) => p[k] && p[k].length);
});
</script>
