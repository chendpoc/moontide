import fs from "node:fs";

import { dirname } from "./path.js";

export function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function ensureDirForFile(filePath: string): void {
  ensureDir(dirname(filePath));
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function readTextIfExists(filePath: string): string | undefined {
  if (!exists(filePath)) {
    return undefined;
  }
  return readText(filePath);
}

export function writeText(filePath: string, content: string): void {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

export function appendText(filePath: string, content: string): void {
  fs.appendFileSync(filePath, content, "utf8");
}

export function readLines(filePath: string): string[] {
  if (!exists(filePath)) {
    return [];
  }
  return readText(filePath)
    .split("\n")
    .filter((line) => line.length > 0);
}

export function readBytes(filePath: string): Buffer {
  return fs.readFileSync(filePath);
}

export function writeBytes(filePath: string, content: Buffer): void {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, content);
}

export function fileSize(filePath: string): number {
  return fs.statSync(filePath).size;
}

export function listDir(dirPath: string): string[] {
  return fs.readdirSync(dirPath);
}

export function removeFile(filePath: string): void {
  fs.unlinkSync(filePath);
}

export function renameFile(fromPath: string, toPath: string): void {
  fs.renameSync(fromPath, toPath);
}

export function lstat(filePath: string): fs.Stats {
  return fs.lstatSync(filePath);
}

export function stat(filePath: string): fs.Stats {
  return fs.statSync(filePath);
}

export function openAppend(filePath: string): number {
  return fs.openSync(filePath, "a");
}

export function closeFd(fd: number): void {
  fs.closeSync(fd);
}

export function mkdtemp(prefixPath: string): string {
  return fs.mkdtempSync(prefixPath);
}

export function removePath(path: string, options?: { recursive?: boolean }): void {
  fs.rmSync(path, { recursive: options?.recursive ?? false, force: true });
}
