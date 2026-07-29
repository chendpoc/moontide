import fs from "node:fs";
import path from "node:path";

export function appendFs(filePath: string, content: string): void {
  fs.appendFileSync(filePath, content, "utf8");
}

export function writeFs(filePath: string, content: string): void {
  mkdirFs(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

export function readFs(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function existsFs(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function mkdirFs(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}
