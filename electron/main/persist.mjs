import { app } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

function fileOf(name) {
  return path.join(app.getPath('userData'), name);
}
export async function readJson(name, fallback) {
  try {
    const txt = await readFile(fileOf(name), 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}
export async function writeJson(name, data) {
  const f = fileOf(name);
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(data), 'utf8');
}
