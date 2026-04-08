import fs from "node:fs";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import { log, withEsc } from "./utils.js";

export async function installWorkflow(packageRoot: string): Promise<void> {
  const lang = await withEsc(select({
    message: "CLAUDE.md language:",
    choices: [
      { name: "English", value: "en" as const },
      { name: "中文", value: "zh-CN" as const },
    ],
    default: "en",
  }));

  const targetDir = await withEsc(input({
    message: "Workflow install target directory:",
    default: process.cwd(),
  }));

  const resolved = path.resolve(targetDir);
  if (!fs.existsSync(resolved)) {
    log.error(`Directory does not exist: ${resolved}`);
    return;
  }

  const sourceFile = lang === "zh-CN" ? "CLAUDE.zh-CN.md" : "CLAUDE.md";
  const sourceClaude = path.join(packageRoot, sourceFile);
  const targetClaude = path.join(resolved, "CLAUDE.md");
  const targetAgents = path.join(resolved, "AGENTS.md");

  // Copy CLAUDE.md
  if (fs.existsSync(targetClaude)) {
    const bakPath = targetClaude + ".bak";
    fs.copyFileSync(targetClaude, bakPath);
    log.warn(`Existing CLAUDE.md backed up to CLAUDE.md.bak`);
  }

  fs.copyFileSync(sourceClaude, targetClaude);
  log.ok(`CLAUDE.md copied (${lang === "zh-CN" ? "中文" : "English"})`);

  // Create AGENTS.md symlink
  try {
    fs.lstatSync(targetAgents);
    fs.unlinkSync(targetAgents);
  } catch {
    // does not exist, proceed
  }
  fs.symlinkSync("CLAUDE.md", targetAgents);
  log.ok("AGENTS.md -> CLAUDE.md symlink created");
}
