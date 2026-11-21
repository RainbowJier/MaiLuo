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

    <nav class="nav"></nav>

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
import { computed } from 'vue';
import { S } from '../store.js';

const projectName = computed(() =>
  S.config.root ? S.config.root.split(/[\\/]/).filter(Boolean).pop() : '未配置');
</script>
