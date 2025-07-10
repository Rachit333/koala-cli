#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const fsExtra = require("fs-extra");
const readline = require("readline");
const { execSync } = require("child_process");
const chalk = require("chalk");
const os = require("os");
const net = require("net");
const { spawn } = require("child_process");
const SERVER_PORT = process.env.KOALA_PORT || 80;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

const [, , command, ...args] = process.argv;

const symbols = {
  info: chalk.blue("[i]"),
  success: chalk.green("[+]"),
  error: chalk.red("[x]"),
  warn: chalk.yellow("[!]"),
};

const DEFAULT_APPS_DIR = "/opt/koala-apps";

function getGlobalConfigPath() {
  return path.join(os.homedir(), ".koala-config.json");
}

function loadGlobalConfig() {
  const configPath = getGlobalConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveGlobalConfig(data) {
  const configPath = getGlobalConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

function printHelp() {
  console.log(`
${chalk.bold("Koala CLI - Simple Local App Deployment")}

Usage:
  koala init                          Setup current folder with a .koala.json config (auto)
  koala init --manual                 Setup using guided prompts
  koala run                           Build and deploy current app (requires .koala.json)
  koala open <appname>                Open deployed app in browser
  koala update                        Update .koala.json from package.json
  koala delete [-r] [--force]         Delete .koala.json and stop app (use -r to remove deployed folder)
  koala inspect                       View current .koala.json config
  koala status                        View status of all deployed apps
  koala stop <appname>                Stop a running app by name
  koala restart <appname>             Restart a running app
  koala logs <appname>                View logs of a deployed app
  koala config                        View global koala settings
  koala config set <path>             Set global deploy directory path
  koala help                          Show this help message
  koala version                       Show current Koala CLI version
`);
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

async function ensureServerRunning() {
  const running = await isPortOpen(SERVER_PORT);
  if (running) return;

  console.log(`${symbols.info} Starting Koala server...`);

  const child = spawn("node", ["server/index.js"], {
    cwd: __dirname + "/..",
    detached: true,
    stdio: "ignore",
  });

  child.unref();
}

if (
  ["init", "run", "deploy", "logs", "restart", "stop", "delete"].includes(
    command
  )
) {
  ensureServerRunning();
}

function createKoalaConfig(appPath, name, template, pkg = {}) {
  let buildCommand;
  let startCommand;

  switch (template) {
    case "react":
      buildCommand = "npm run build";
      startCommand = "PORT=$PORT npm start";
      break;
    case "next":
      buildCommand = "npm run build";
      startCommand = "PORT=$PORT npm run start";
      break;
    case "vue":
      buildCommand = "npm run build";
      startCommand = "PORT=$PORT npm run dev";
      break;
    case "angular":
      buildCommand = "ng build";
      startCommand = "PORT=$PORT ng serve --open";
      break;
    case "svelte":
      buildCommand = "npm run build";
      startCommand = "PORT=$PORT npm run dev";
      break;
    case "express":
      buildCommand = "npm install";
      startCommand = pkg.scripts?.start
        ? "PORT=$PORT npm start"
        : "PORT=$PORT node index.js";
      break;
    default:
      buildCommand = pkg.scripts?.build ? "npm run build" : "npm install";
      startCommand = pkg.scripts?.start
        ? "PORT=$PORT npm start"
        : "PORT=$PORT node index.js";
      break;
  }

  const config = {
    name,
    type: template,
    build: buildCommand,
    start: startCommand,
    port: 0,
    description: pkg.description || "",
    version: pkg.version || "1.0.0",
    author: pkg.author || "",
    license: pkg.license || "MIT",
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(appPath, ".koala.json"),
    JSON.stringify(config, null, 2)
  );
}

function validateConfig(config) {
  if (!config || typeof config !== "object") return "Invalid config format";
  const requiredFields = ["name", "type", "build", "start"];
  for (const field of requiredFields) {
    if (!(field in config)) return `Missing field: ${field}`;
    if (typeof config[field] !== "string")
      return `Invalid type for field: ${field}`;
  }
  return null;
}

function getGlobalConfigPath() {
  return path.join(require("os").homedir(), ".koala-config.json");
}

function loadGlobalConfig() {
  const configPath = getGlobalConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveGlobalConfig(data) {
  const configPath = getGlobalConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

async function main() {
  if (command === "__complete") {
    const commands = [
      "init",
      "run",
      "deploy",
      "status",
      "stop",
      "restart",
      "logs",
      "open",
      "delete",
      "update",
      "inspect",
      "config",
      "help",
      "version",
      "list",
    ];
    const input = args[0] || "";
    const matches = commands.filter((cmd) => cmd.startsWith(input));
    console.log(matches.join("\n"));
    process.exit(0);
  }

  if (!command || command === "help" || command === "-h") {
    return printHelp();
  } else if (command === "config" || command === "--cfg") {
    const config = loadGlobalConfig();

    if (args[0] === "set" && args[1]) {
      const inputPath = args.slice(1).join(" ").trim();
      if (!fs.existsSync(inputPath)) {
        console.error(
          `${symbols.error} ${chalk.red("Path does not exist:")} ${chalk.yellow(
            inputPath
          )}`
        );
        return;
      }
      config.appsDir = inputPath;
      saveGlobalConfig(config);
      console.log(
        `${symbols.success} ${chalk.green(
          "Saved deploy path to:"
        )} ${chalk.cyan(inputPath)}`
      );
      return;
    }

    if (args.length === 0 || args[0] !== "set") {
      console.log(chalk.bold("\nKoala Global Config:\n"));
      for (const [key, value] of Object.entries(config)) {
        console.log(`${chalk.green(key)}: ${chalk.cyan(value)}`);
      }
      console.log(
        `\n${symbols.info} ${chalk.gray(
          "To set deploy path:"
        )} ${chalk.whiteBright(
          "koala config set /path/to/koala/app/deploy/folder"
        )}`
      );
      return;
    }

    console.error(`${symbols.error} ${chalk.red("Invalid config command.")}`);
  }

  if (command === "--version" || command === "-v") {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
      );
      console.log(`${symbols.info} Koala CLI version: ${pkg.version}`);
    } catch (err) {
      console.error(`${symbols.error} Unable to read version: ${err.message}`);
    }
    return;
  }

  if (command === "init") {
    const cwd = process.cwd();
    const configPath = path.join(cwd, ".koala.json");

    if (fs.existsSync(configPath)) {
      console.error(
        `${symbols.error} .koala.json already exists in this directory.`
      );
      return;
    }

    if (args[0] === "--manual") {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      function ask(question) {
        return new Promise((resolve) => rl.question(question, resolve));
      }

      try {
        const name = await ask("App name: ");
        const template = await ask("Template type (next, react, express): ");
        createKoalaConfig(cwd, name.trim(), template.trim());
        console.log(`${symbols.success} .koala.json created. You can now run:`);
        console.log("   koala run");
      } finally {
        rl.close();
      }
    } else {
      try {
        const pkgPath = path.join(cwd, "package.json");
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const name = pkg.name || path.basename(cwd);
        const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
        let template = "unknown";
        if (deps["next"]) template = "next";
        else if (deps["react"]) template = "react";
        else if (deps["express"]) template = "express";

        createKoalaConfig(cwd, name, template, pkg);
        console.log(
          `${symbols.success} Auto-created .koala.json using detected template: ${template}`
        );
        console.log("   koala run");
      } catch (err) {
        console.error(`${symbols.error} Failed to auto-init: ${err.message}`);
        console.log(`${symbols.info} Try: koala init --manual`);
      }
    }
    return;
  } else if (command === "run") {
    if (args.length === 1) {
      const name = args[0];
      try {
        await axios.post(`${SERVER_URL}/control/${name}/restart`);
        console.log(`${symbols.success} Resumed app "${name}"`);
      } catch (err) {
        console.error(
          `${symbols.error} Failed to resume "${name}": ${
            err.response?.data?.error || err.message
          }`
        );
      }
      return;
    }

    const cwd = process.cwd();
    const configPath = path.join(process.cwd(), ".koala.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const validationError = validateConfig(config);

    if (validationError) {
      console.error(`${symbols.error} Invalid .koala.json: ${validationError}`);
      return;
    }

    const { name, type: template } = config;
    console.log(
      `${symbols.info} Deploying "${name}" using template "${template}"`
    );

    const global = loadGlobalConfig();
    const basePath = loadGlobalConfig().appsDir || DEFAULT_APPS_DIR;
    const dest = path.join(basePath, name);

    if (fs.existsSync(dest)) {
      try {
        await fsExtra.remove(dest);
        console.log(`${symbols.warn} Deleted existing app folder: ${dest}`);
      } catch {
        try {
          execSync(`sudo rm -rf "${dest}"`);
        } catch (sudoErr) {
          console.error(
            `${symbols.error} Failed to delete app folder even with sudo: ${sudoErr.message}`
          );
          return;
        }
      }
    }

    try {
      await fsExtra.copy(cwd, dest, {
        filter: (src) => !src.includes(".eslintcache"),
      });

      try {
        execSync(`sudo chown -R koala:koala "${dest}"`);
        console.log(`${symbols.info} Fixed permissions for: ${dest}`);
      } catch (err) {
        console.error(`${symbols.warn} Failed to chown files: ${err.message}`);
      }

      console.log(
        `${symbols.success} Project copied to local server dir: ${dest}`
      );
    } catch (copyErr) {
      console.error(
        `${symbols.error} Failed to copy project: ${copyErr.message}`
      );
      return;
    }

    try {
      const res = await axios.post(`${SERVER_URL}/deploy`, {
        name,
        template,
        path: dest,
      });
      console.log(`${symbols.success} Server says:`, res.data);
    } catch (err) {
      console.error(
        `${symbols.error} Deploy failed:`,
        err.response?.data || err.message
      );
    }
  } else if (command === "open") {
    const app = args[0];
    if (!app) return console.log("Usage: koala open <appname>");
    const url = `http://${app}.localhost`;
    const openCmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
        ? "start"
        : "xdg-open";
    try {
      execSync(`${openCmd} ${url}`);
      console.log(`${symbols.success} Opened ${url}`);
    } catch (err) {
      console.error(`${symbols.error} Failed to open browser: ${err.message}`);
    }
  } else if (command === "status") {
    try {
      const { data } = await axios.get(`${SERVER_URL}/status`);
      console.log(chalk.bold("App Status:\n"));
      for (const [name, { port, running, memory, cpu }] of Object.entries(
        data
      )) {
        const status = running
          ? `${chalk.green("[RUNNING]")} http://${name}.localhost`
          : `${chalk.red("[STOPPED]")}`;
        const mem = memory ? chalk.blue(`Memory: ${memory}`) : "";
        const cpuUsage = cpu ? chalk.magenta(`CPU: ${cpu}`) : "";

        console.log(
          `${chalk.cyan(
            name.padEnd(14)
          )} ${status} (port ${port}) ${mem} ${cpuUsage}`
        );
      }
    } catch (err) {
      console.error(
        `${symbols.error} Failed to fetch status: ${
          err.response?.data?.error || err.message
        }`
      );
    }
  } else if (command === "stop") {
    const app = args[0];
    if (!app) return console.log("Usage: koala stop <appname>");
    try {
      const { data } = await axios.post(`${SERVER_URL}/control/${app}/stop`);
      console.log(`${symbols.success} ${data.message}`);
    } catch (err) {
      console.error(
        `${symbols.error} ${err.response?.data?.error || err.message}`
      );
    }
  } else if (command === "restart") {
    const app = args[0];
    if (!app) return console.log("Usage: koala restart <appname>");
    try {
      const { data } = await axios.post(`${SERVER_URL}/control/${app}/restart`);
      console.log(`${symbols.success} ${data.message}`);
    } catch (err) {
      console.error(
        `${symbols.error} ${err.response?.data?.error || err.message}`
      );
    }
  } else if (command === "update") {
    const cwd = process.cwd();
    const configPath = path.join(cwd, ".koala.json");
    const pkgPath = path.join(cwd, "package.json");

    if (!fs.existsSync(configPath)) {
      console.error(
        `${symbols.error} .koala.json not found. Run "koala init" first.`
      );
      return;
    }
    if (!fs.existsSync(pkgPath)) {
      console.error(`${symbols.error} package.json not found.`);
      return;
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const name = pkg.name || config.name;
      const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
      let template = "unknown";
      if (deps["next"]) template = "next";
      else if (deps["react"]) template = "react";
      else if (deps["express"]) template = "express";

      createKoalaConfig(cwd, name, template, pkg);
      console.log(`${symbols.success} .koala.json updated from package.json`);
    } catch (err) {
      console.error(`${symbols.error} Failed to update config: ${err.message}`);
    }
    return;
  } else if (command === "inspect") {
    const configPath = path.join(process.cwd(), ".koala.json");
    if (!fs.existsSync(configPath)) {
      console.error(`${symbols.error} .koala.json not found.`);
      return;
    }
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      console.log(chalk.bold("Current Koala Config:\n"));
      for (const [key, value] of Object.entries(config)) {
        console.log(`${chalk.green(key)}: ${value}`);
      }
    } catch (err) {
      console.error(`${symbols.error} Failed to read config: ${err.message}`);
    }
    return;
  } else if (command === "logs") {
    const app = args[0];
    if (!app) return console.log("Usage: koala logs <appname>");
    try {
      const { data } = await axios.get(`${SERVER_URL}/control/${app}/logs`);
      console.log(`${symbols.info} Logs for ${chalk.yellow(app)}:\n\n${data}`);
    } catch (err) {
      console.error(
        `${symbols.error} ${err.response?.data?.error || err.message}`
      );
    }
  } else if (command === "delete") {
    const cwd = process.cwd();
    const configPath = path.join(cwd, ".koala.json");
    const rootFlag = args.includes("-r");
    const forceFlag = args.includes("--force");

    if (!fs.existsSync(configPath)) {
      console.error(`${symbols.error} No .koala.json found to delete.`);
      return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const name = config.name;

    try {
      fs.unlinkSync(configPath);
      console.log(`${symbols.success} .koala.json deleted`);

      await axios.post(`${SERVER_URL}/control/${name}/stop`);
      console.log(`${symbols.success} Stopped app "${name}" on server`);

      if (rootFlag) {
        const basePath = loadGlobalConfig().appsDir || DEFAULT_APPS_DIR;
        const deployedPath = path.join(basePath, name);

        if (forceFlag) {
          if (fs.existsSync(deployedPath)) {
            try {
              await fsExtra.remove(deployedPath);
              console.log(
                `${symbols.success} Removed deployed app folder: ${deployedPath}`
              );
            } catch {
              try {
                execSync(`sudo rm -rf "${deployedPath}"`);
                console.log(
                  `${symbols.success} Removed via sudo: ${deployedPath}`
                );
              } catch (sudoErr) {
                console.error(
                  `${symbols.error} Failed to delete via sudo: ${sudoErr.message}`
                );
              }
            }
          } else {
            console.log(
              `${symbols.warn} No folder at ${deployedPath} to delete`
            );
          }
        } else {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl.question(
            `Type "${name}" to confirm deletion of deployed folder: `,
            async (answer) => {
              rl.close();
              if (answer.trim() !== name) {
                console.error(`${symbols.error} Confirmation failed. Aborted.`);
                return;
              }
              if (fs.existsSync(deployedPath)) {
                await fsExtra.remove(deployedPath);
                console.log(
                  `${symbols.success} Removed deployed folder: ${deployedPath}`
                );
              } else {
                console.log(
                  `${symbols.warn} No folder at ${deployedPath} to delete`
                );
              }
            }
          );
        }
      }
    } catch (err) {
      console.error(
        `${symbols.error} Failed to delete or stop app: ${
          err.response?.data?.error || err.message
        }`
      );
    }
    return;
  } else if (command === "list") {
    try {
      const { data } = await axios.get(`${SERVER_URL}/apps`);
      if (!data.length) {
        console.log(`${symbols.warn} No apps currently deployed.`);
        return;
      }
      console.log(chalk.bold("Deployed Apps:\n"));
      data.forEach((app) => console.log(`- ${chalk.cyan(app)}`));
    } catch (err) {
      console.error(`${symbols.error} Failed to fetch list: ${err.message}`);
    }
  } else {
    console.error(`${symbols.error} Unknown command: "${command}"`);
    printHelp();
  }
}

main();
