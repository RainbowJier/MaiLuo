import { createApp } from 'vue';
import App from './App.vue';
import * as store from './store.js';
import './styles/global.css';

createApp(App).mount('#app');

// 开发期调试/自动化入口（生产构建不包含）
if (import.meta.env.DEV) window.__chain = store;
