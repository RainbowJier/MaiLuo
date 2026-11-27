/**
 * 从「另一个 Claude Code 会话」里启动 MaiLuo 时（IDE 内置终端、agent shell 等），
 * 环境里会带有子会话标记。app 内 spawn 的 claude 一旦继承这些标记，就会关闭
 * transcript 落盘（“Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION
 * marker”）：会话 jsonl 不再追加，分析提取永远等不到 end_turn，界面卡在「分析中」。
 *
 * dev 启动器与 PTY 宿主共用这一份清单，避免两边各维护一套而漂移。
 */
export const CLAUDE_SESSION_MARKERS = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDECODE',
  'CLAUDE_PID'
];

/** 返回剥掉这些标记的 env 副本（不修改入参）。 */
export function stripClaudeSessionMarkers(env) {
  const clean = { ...env };
  for (const k of CLAUDE_SESSION_MARKERS) delete clean[k];
  return clean;
}
