import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_OPTIONS = 300;
const MAX_MODEL_LENGTH = 120;
const INVALID_MODEL = /[\s"']/;

/**
 * Claude Code 自己的 settings.json 依次合并：用户级 → 项目级 → 项目本地级。
 * modelPicker.options 是 /model 面板里可选的模型清单，数组按后者整体覆盖。
 */
export function claudeSettingsFiles({ env = process.env, home = os.homedir(), cwd = process.cwd() } = {}) {
  const userDir = path.resolve(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'));
  const projectDir = path.resolve(cwd, '.claude');
  return [
    path.join(userDir, 'settings.json'),
    path.join(projectDir, 'settings.json'),
    path.join(projectDir, 'settings.local.json')
  ];
}

function readSettings(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(), out = [];
  for (const item of value) {
    const model = typeof item?.model === 'string' ? item.model.trim() : '';
    if (!model || model.length > MAX_MODEL_LENGTH || INVALID_MODEL.test(model) || seen.has(model)) continue;
    seen.add(model);
    const label = typeof item?.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 120) : model;
    const description = typeof item?.description === 'string' ? item.description.trim().slice(0, 200) : '';
    out.push({ model, label, description });
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

/** 读取本机 Claude Code 配置的 modelPicker.options，不注入任何内置模型。 */
export function loadClaudeModels(options = {}) {
  let picker;
  let defaultModel = '';
  for (const file of claudeSettingsFiles(options)) {
    const settings = readSettings(file);
    if (!settings) continue;
    if (settings.modelPicker?.options !== undefined) picker = settings.modelPicker.options;
    if (typeof settings.model === 'string') defaultModel = settings.model.trim();
  }
  if (defaultModel.length > MAX_MODEL_LENGTH || INVALID_MODEL.test(defaultModel)) defaultModel = '';
  const models = normalizeOptions(picker);
  if (!models.length && defaultModel) models.push({ model: defaultModel, label: `${defaultModel} · 配置默认`, description: '' });
  return { models, defaultModel };
}
