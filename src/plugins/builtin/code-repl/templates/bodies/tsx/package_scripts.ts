import fs from "node:fs";

/*__VARS__*/

const filePath = __VARS__.path as string;
const raw = fs.readFileSync(filePath, "utf8");
const pkg = JSON.parse(raw) as {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

console.log(
  JSON.stringify({
    path: filePath,
    name: pkg.name ?? null,
    scripts: pkg.scripts ?? {},
    dependencies: Object.keys(pkg.dependencies ?? {}),
    devDependencies: Object.keys(pkg.devDependencies ?? {}),
  }),
);
