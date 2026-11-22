<template>
  <div class="layout">
    <Sidebar />
    <DetailPanel />
    <AgentTerminal />
  </div>
  <ConfigModal />
  <div class="global-toast" :class="{ hide: !S.toast }">{{ S.toast }}</div>
</template>

<script setup>
import { onMounted } from 'vue';
import Sidebar from './components/Sidebar.vue';
import DetailPanel from './components/DetailPanel.vue';
import AgentTerminal from './components/AgentTerminal.vue';
import ConfigModal from './components/ConfigModal.vue';
import { S, initApp } from './store.js';

onMounted(() => initApp());
</script>
