<template>
  <div v-if="S.configOpen" class="modal-overlay" @click.self="S.configOpen = false">
    <div class="modal">
      <div class="modal-header">
        <h2>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2.5 5.5c0-.6.4-1 1-1h4l1.5 2h7.5c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1h-13c-.6 0-1-.4-1-1v-9z"/>
          </svg>
          项目配置
        </h2>
        <button class="modal-close" @click="S.configOpen = false">✕</button>
      </div>
      <div class="modal-body">
        <div class="config-group">
          <label>项目根路径（包含前后端代码的文件夹）</label>
          <div class="input-with-btn">
            <input v-model="form.root" type="text" placeholder="D:\Projects\my-app" @change="onRootChange" />
            <button class="btn-secondary" @click="browse('root')">浏览</button>
          </div>
          <div v-if="detected" class="detect-tip">
            自动探测：前端 <b>{{ detected.frontend || '未识别' }}</b> · 后端 <b>{{ detected.backend || '未识别' }}</b>
          </div>
        </div>
        <div class="config-group">
          <label>前端项目路径（相对根路径，留空则自动探测）</label>
          <div class="input-with-btn">
            <input v-model="form.frontend" type="text" placeholder="例：frontend / web / admin" />
            <button class="btn-secondary" @click="browse('frontend')">浏览</button>
          </div>
        </div>
        <div class="config-group">
          <label>后端项目路径（相对根路径，留空则自动探测）</label>
          <div class="input-with-btn">
            <input v-model="form.backend" type="text" placeholder="例：backend / server / api" />
            <button class="btn-secondary" @click="browse('backend')">浏览</button>
          </div>
        </div>
        <div class="modal-note">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="6.2"/><path d="M8 7.5v3.5M8 5.2v.6"/>
          </svg>
          <span>「开始分析」默认以最高权限直接执行、不逐项确认（仅提示保持只读）；对话中的命令或文件修改仍会先弹出授权卡片。使用本机 Claude Code 登录状态{{ S.claudeOk ? '' : '；⚠ 未检测到 claude CLI，请先安装' }}。</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-ghost" @click="S.configOpen = false">取消</button>
        <button class="btn-primary" style="padding:9px 22px" @click="save">保存配置</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from 'vue';
import { S, saveConfigFlow } from '../store.js';

const form = reactive({ root: '', frontend: '', backend: '' });
const detected = ref(null);

watch(() => S.configOpen, (open) => {
  if (open) {
    form.root = S.config.root;
    form.frontend = S.config.frontend;
    form.backend = S.config.backend;
    detected.value = null;
    if (form.root) onRootChange();
  }
});

async function onRootChange() {
  if (!form.root) { detected.value = null; return; }
  detected.value = await window.api.detectProjects(form.root);
  if (!form.frontend && detected.value.frontend) form.frontend = detected.value.frontend;
  if (!form.backend && detected.value.backend) form.backend = detected.value.backend;
}
async function browse(field) {
  if (field === 'root') {
    const dir = await window.api.selectFolder();
    if (dir) { form.root = dir; await onRootChange(); }
  } else {
    // 子目录浏览：从根路径下选择
    const dir = await window.api.selectFolder();
    if (dir && form.root) {
      const rel = dir.replace(form.root, '').replace(/^[\\/]+/, '');
      form[field] = rel || '.';
    }
  }
}
async function save() {
  if (!form.root) { return; }
  await saveConfigFlow({ ...form });
}
</script>
