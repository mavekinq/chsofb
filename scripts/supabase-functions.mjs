import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = process.cwd();
const supabaseDir = path.join(workspaceRoot, "supabase");
const functionsDir = path.join(supabaseDir, "functions");
const configPath = path.join(supabaseDir, "config.toml");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!existsSync(configPath)) {
  fail(`Supabase config not found: ${configPath}`);
}

if (!existsSync(functionsDir)) {
  fail(`Supabase functions directory not found: ${functionsDir}`);
}

const config = readFileSync(configPath, "utf8");
const projectIdMatch = config.match(/^project_id\s*=\s*"([^"]+)"/m);
const projectId = projectIdMatch?.[1];

if (!projectId) {
  fail(`project_id not found in ${configPath}`);
}

const functionNames = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const runSupabase = (args) => {
  const result = spawnSync("npx", ["supabase", ...args], {
    cwd: workspaceRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const command = process.argv[2];
const target = process.argv[3];

if (!command || !["list", "deploy"].includes(command)) {
  fail([
    "Usage:",
    "  npm run supabase:functions:list",
    "  npm run supabase:functions:deploy -- <function-name>",
    "  npm run supabase:functions:deploy:all",
  ].join("\n"));
}

if (command === "list") {
  runSupabase(["functions", "list", "--project-ref", projectId]);
  process.exit(0);
}

if (!target) {
  fail(`Function name is required. Available: ${functionNames.join(", ")}`);
}

if (target === "all") {
  for (const functionName of functionNames) {
    console.log(`\nDeploying ${functionName}...`);
    runSupabase(["functions", "deploy", functionName, "--project-ref", projectId]);
  }
  process.exit(0);
}

if (!functionNames.includes(target)) {
  fail(`Unknown function: ${target}. Available: ${functionNames.join(", ")}`);
}

runSupabase(["functions", "deploy", target, "--project-ref", projectId]);