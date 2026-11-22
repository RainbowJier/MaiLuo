import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeSettingsFiles, loadClaudeModels } from '../electron/main/claude-models.mjs';

function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), 'mailuo-models-'));
  const project = path.join(home, 'project');
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  mkdirSync(path.join(project, '.claude'), { recursive: true });
  return {
    home, project,
    write(file, data) { writeFileSync(file, JSON.stringify(data)); },
    cleanup() { rmSync(home, { recursive: true, force: true }); }
  };
}

test('model options come from the local Claude Code modelPicker, deduplicated and validated', () => {
  const f = fixture();
  try {
    f.write(path.join(f.home, '.claude', 'settings.json'), {
      model: 'deepseek/deepseek-v4.1-flash-1017',
      modelPicker: { options: [
        { model: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash', description: 'via magpie' },
        { model: 'zcode/glm-5.3', label: 'GLM 5.3' },
        { model: 'zcode/glm-5.3', label: 'duplicate is dropped' },
        { model: 'bad model', label: 'invalid whitespace' },
        { model: 'bad"quote' },
        { model: 'no-label' },
        { model: '' }
      ] }
    });
    const result = loadClaudeModels({ env: {}, home: f.home, cwd: f.project });
    assert.deepEqual(result.models.map(m => m.model),
      ['deepseek/deepseek-v4.1-flash-1017', 'zcode/glm-5.3', 'no-label']);
    assert.equal(result.models[0].label, 'DeepSeek V4.1 Flash');
    assert.equal(result.models[1].description, '');
    assert.equal(result.models[2].label, 'no-label');
    assert.equal(result.defaultModel, 'deepseek/deepseek-v4.1-flash-1017');
  } finally { f.cleanup(); }
});

test('project settings override the user picker; settings.local.json overrides the project', () => {
  const f = fixture();
  try {
    f.write(path.join(f.home, '.claude', 'settings.json'), {
      modelPicker: { options: [{ model: 'user/model', label: 'User' }] }
    });
    f.write(path.join(f.project, '.claude', 'settings.json'), {
      modelPicker: { options: [{ model: 'project/model', label: 'Project' }] }
    });
    assert.deepEqual(loadClaudeModels({ env: {}, home: f.home, cwd: f.project }).models.map(m => m.model),
      ['project/model']);
    f.write(path.join(f.project, '.claude', 'settings.local.json'), {
      modelPicker: { options: [{ model: 'local/model', label: 'Local' }] }
    });
    assert.deepEqual(loadClaudeModels({ env: {}, home: f.home, cwd: f.project }).models.map(m => m.model),
      ['local/model']);
  } finally { f.cleanup(); }
});

test('CLAUDE_CONFIG_DIR selects the config directory and missing pickers fall back to the configured model', () => {
  const f = fixture();
  try {
    const custom = path.join(f.home, 'custom-config');
    mkdirSync(custom);
    f.write(path.join(custom, 'settings.json'), { model: 'zcode/glm-5.3-flash' });
    const files = claudeSettingsFiles({ env: { CLAUDE_CONFIG_DIR: custom }, home: f.home, cwd: f.project });
    assert.equal(files[0], path.join(custom, 'settings.json'));
    const result = loadClaudeModels({ env: { CLAUDE_CONFIG_DIR: custom }, home: f.home, cwd: f.project });
    assert.deepEqual(result.models, [{ model: 'zcode/glm-5.3-flash', label: 'zcode/glm-5.3-flash · 配置默认', description: '' }]);
    assert.equal(result.defaultModel, 'zcode/glm-5.3-flash');
  } finally { f.cleanup(); }
});
