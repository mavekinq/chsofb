import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();

async function findLatestExcel(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const excelFiles = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        if (!entry.name.toLowerCase().endsWith(".xlsx") || entry.name.startsWith("~$")) {
          return null;
        }

        const filePath = path.join(directory, entry.name);
        const fileStat = await stat(filePath);
        return { filePath, mtimeMs: fileStat.mtimeMs };
      }),
  );

  return excelFiles
    .filter(Boolean)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath ?? null;
}

function resolvePython() {
  const candidates = [
    path.join(rootDir, ".venv", "Scripts", "python.exe"),
    path.join(rootDir, ".venv", "bin", "python"),
    "python",
    "py",
  ];

  return candidates.find((candidate) => candidate === "python" || candidate === "py" || existsSync(candidate));
}

async function main() {
  const providedSource = process.argv[2];
  const sourcePath = providedSource ? path.resolve(rootDir, providedSource) : await findLatestExcel(rootDir);

  if (!sourcePath) {
    console.error("Kullanilacak .xlsx dosyasi bulunamadi.");
    process.exit(1);
  }

  const python = resolvePython();
  if (!python) {
    console.error("Python bulunamadi. .venv icinde veya sistem PATH'inde python olmali.");
    process.exit(1);
  }

  const scriptPath = path.join(rootDir, "scripts", "import_work_schedule.py");
  const child = spawn(python, [scriptPath, sourcePath], {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});