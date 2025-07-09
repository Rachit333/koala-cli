// const express = require("express");
// const fs = require("fs-extra");
// const path = require("path");
// const { spawn } = require("child_process");
// const { registerApp } = require("./proxy");
// const { execSync } = require("child_process");
// const app = express();
// const PORT = 1993;

// app.use(express.json());
// app.use(require("cors")());

// const apps = {}; // in-memory registry

// // POST /deploy
// app.post("/deploy", async (req, res) => {
//   const { name, template, path: appPath } = req.body;

//   const configPath = path.join(appPath, ".koala.json");
//   if (!fs.existsSync(configPath)) {
//     return res
//       .status(400)
//       .json({ success: false, message: ".koala.json not found" });
//   }

//   const config = JSON.parse(await fs.readFile(configPath, "utf8"));
//   const port = 3100 + Object.keys(apps).length;

//   console.log(`🔧 [${name}] Running build...`);
//   const build = spawn(config.build, { cwd: appPath, shell: true });

//   let buildOutput = "";
//   build.stdout.on("data", (data) => (buildOutput += data));
//   build.stderr.on("data", (data) => (buildOutput += data));

//   build.on("exit", (code) => {
//     if (code !== 0) {
//       console.error(`❌ Build failed:\n${buildOutput}`);
//       return res.status(500).json({ success: false, message: "Build failed" });
//     }

//     console.log(`✅ Build complete:\n${buildOutput}`);
//     console.log(`🚀 [${name}] Starting on port ${port}`);

//     const logs = [];
//     const child = spawn(config.start, {
//       cwd: appPath,
//       shell: true,
//       env: { ...process.env, PORT: port },
//     });

//     child.stdout.on("data", (data) => {
//       const line = `[${name}] ${data.toString()}`;
//       logs.push(line);
//       if (logs.length > 1000) logs.shift(); 
//       process.stdout.write(line);
//     });

//     child.stderr.on("data", (data) => {
//       const line = `[${name} ERROR] ${data.toString()}`;
//       logs.push(line);
//       if (logs.length > 1000) logs.shift();
//       process.stderr.write(line);
//     });

//     apps[name] = {
//       name,
//       port,
//       template,
//       process: child,
//       logs,
//       running: true,
//       path: appPath,
//       start: config.start,
//     };

//     registerApp(name, port);

//     res.json({
//       success: true,
//       message: `${name} running at http://${name}.localhost`,
//       port,
//     });
//   });
// });

// app.post("/control/:name/stop", (req, res) => {
//   const app = apps[req.params.name];
//   if (!app || !app.process) {
//     return res
//       .status(404)
//       .json({ error: `App "${req.params.name}" not found or not running.` });
//   }
//   app.process.kill();
//   app.running = false;
//   res.json({ success: true, message: `Stopped "${req.params.name}"` });
// });

// app.post("/control/:name/restart", (req, res) => {
//   const app = apps[req.params.name];
//   if (!app) {
//     return res
//       .status(404)
//       .json({ error: `App "${req.params.name}" not found.` });
//   }

//   if (app.process) app.process.kill();

//   const child = spawn(app.start, {
//     cwd: app.path,
//     shell: true,
//     env: { ...process.env, PORT: app.port },
//   });

//   app.logs = [];
//   app.running = true;
//   app.process = child;

//   child.stdout.on("data", (data) => {
//     const line = `[${app.name}] ${data.toString()}`;
//     app.logs.push(line);
//     if (app.logs.length > 1000) app.logs.shift();
//     process.stdout.write(line);
//   });

//   child.stderr.on("data", (data) => {
//     const line = `[${app.name} ERROR] ${data.toString()}`;
//     app.logs.push(line);
//     if (app.logs.length > 1000) app.logs.shift();
//     process.stderr.write(line);
//   });

//   res.json({ success: true, message: `Restarted "${app.name}"` });
// });

// app.get("/control/:name/logs", (req, res) => {
//   const app = apps[req.params.name];
//   if (!app || !app.logs) {
//     return res.status(404).json({ error: `No logs for "${req.params.name}".` });
//   }
//   res.type("text/plain").send(app.logs.join("\n").slice(-4000));
// });

// app.get("/status", (req, res) => {
//   const status = {};
//   for (const name in apps) {
//     const appData = apps[name];
//     const folderExists = fs.existsSync(appData.path);

//     let memory = "";
//     let cpu = "";

//     if (appData.running && folderExists && appData.process?.pid) {
//       try {
//         const pid = appData.process.pid;
//         const output = execSync(
//           `ps -p ${pid} -o %cpu,rss --no-headers`
//         ).toString();
//         const [cpuStr, memKb] = output.trim().split(/\s+/);
//         cpu = cpuStr + "%";
//         memory = (parseInt(memKb, 10) / 1024).toFixed(1) + " MB";
//       } catch (e) {
//         memory = "n/a";
//         cpu = "n/a";
//       }
//     }

//     status[name] = {
//       port: appData.port,
//       running: appData.running && folderExists,
//       folderMissing: !folderExists,
//       memory,
//       cpu,
//     };
//   }
//   res.json(status);
// });

// app.listen(PORT, () => {
//   console.log(`🧪 Koala server listening at http://localhost:${PORT}`);
// });


const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { registerApp } = require("./proxy");
const chalk = require("chalk");

const app = express();
const PORT = process.env.PORT || 80;
const apps = {};
const REGISTRY_PATH = "/opt/koala-state/registry.json";
const LOCKFILE = "/tmp/.koala-server.lock";

const symbols = {
  info: chalk.blue("[i]"),
  success: chalk.green("[+]"),
  error: chalk.red("[x]"),
  warn: chalk.yellow("[!]"),
};

app.use(express.json());
app.use(require("cors")());

// Prevent duplicate instance via lockfile
if (fs.existsSync(LOCKFILE)) {
  console.error(`${symbols.error} Koala server already running (lockfile exists)`);
  process.exit(1);
}
fs.ensureFileSync(LOCKFILE);
fs.writeFileSync(LOCKFILE, `${Date.now()}`);

// ---- Registry helpers ----
function saveAppRegistry() {
  const plainApps = {};
  for (const [name, data] of Object.entries(apps)) {
    plainApps[name] = {
      name: data.name,
      port: data.port,
      template: data.template,
      path: data.path,
      start: data.start,
      running: data.running,
      startedAt: data.startedAt,
    };
  }
  fs.ensureDirSync(path.dirname(REGISTRY_PATH));
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(plainApps, null, 2));
}

function loadAppRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  } catch (err) {
    console.error(`${symbols.error} Failed to load registry: ${err.message}`);
    return {};
  }
}

function isPortInUse(port) {
  return Object.values(apps).some(app => app.port === port && app.running);
}

// ---- App launching ----
function launchApp(meta) {
  if (isPortInUse(meta.port)) {
    console.warn(`${symbols.warn} Port ${meta.port} already in use. Skipping ${meta.name}`);
    return;
  }

  const child = spawn(meta.start, {
    cwd: meta.path,
    shell: true,
    env: { ...process.env, PORT: meta.port },
  });

  const logs = [];

  child.stdout.on("data", (data) => {
    const line = `[${meta.name}] ${data.toString()}`;
    logs.push(line);
    if (logs.length > 1000) logs.shift();
    process.stdout.write(line);
  });

  child.stderr.on("data", (data) => {
    const line = `[${meta.name} ERROR] ${data.toString()}`;
    logs.push(line);
    if (logs.length > 1000) logs.shift();
    process.stderr.write(line);
  });

  apps[meta.name] = {
    ...meta,
    logs,
    process: child,
    running: true,
    startedAt: new Date().toISOString(),
  };

  registerApp(meta.name, meta.port);
}

// ---- Restore saved apps ----
const savedApps = loadAppRegistry();
for (const [name, meta] of Object.entries(savedApps)) {
  if (!fs.existsSync(meta.path)) {
    console.warn(`${symbols.warn} Skipping restore: ${name} folder missing`);
    continue;
  }
  console.log(`${symbols.info} Restoring ${name} on port ${meta.port}`);
  launchApp(meta);
}

// ---- Deploy endpoint ----
app.post("/deploy", async (req, res) => {
  const { name, template, path: appPath } = req.body;
  const configPath = path.join(appPath, ".koala.json");

  if (!fs.existsSync(configPath)) {
    return res.status(400).json({ success: false, message: ".koala.json not found" });
  }

  const config = JSON.parse(await fs.readFile(configPath, "utf8"));

  if (!config.build || !config.start) {
    return res.status(400).json({ success: false, message: "Missing build/start in config" });
  }

  const port = 3100 + Object.keys(apps).length;

  if (isPortInUse(port)) {
    return res.status(500).json({ success: false, message: `Port ${port} already in use` });
  }

  console.log(`${symbols.info} [${name}] Running build...`);
  const build = spawn(config.build, { cwd: appPath, shell: true });

  let buildOutput = "";
  build.stdout.on("data", (data) => (buildOutput += data));
  build.stderr.on("data", (data) => (buildOutput += data));

  build.on("exit", (code) => {
    if (code !== 0) {
      console.error(`${symbols.error} Build failed:\n${buildOutput}`);
      return res.status(500).json({ success: false, message: "Build failed" });
    }

    console.log(`${symbols.success} Build complete`);
    console.log(`${symbols.success} Starting "${name}" on port ${port}`);

    const meta = {
      name,
      template,
      path: appPath,
      port,
      start: config.start,
    };

    launchApp(meta);
    saveAppRegistry();

    res.json({
      success: true,
      message: `${name} running at http://${name}.localhost`,
      port,
    });
  });
});

// ---- Control endpoints ----
app.post("/control/:name/stop", (req, res) => {
  const app = apps[req.params.name];
  if (!app || !app.process) {
    return res.status(404).json({ error: `App "${req.params.name}" not running.` });
  }
  app.process.kill();
  app.running = false;
  saveAppRegistry();
  res.json({ success: true, message: `Stopped "${req.params.name}"` });
});

app.post("/control/:name/restart", (req, res) => {
  const app = apps[req.params.name];
  if (!app) {
    return res.status(404).json({ error: `App "${req.params.name}" not found.` });
  }
  if (app.process) app.process.kill();
  launchApp(app);
  saveAppRegistry();
  res.json({ success: true, message: `Restarted "${app.name}"` });
});

app.get("/control/:name/logs", (req, res) => {
  const app = apps[req.params.name];
  if (!app || !app.logs) {
    return res.status(404).json({ error: `No logs for "${req.params.name}".` });
  }
  res.type("text/plain").send(app.logs.join("\n").slice(-4000));
});

app.get("/status", (req, res) => {
  const status = {};
  for (const name in apps) {
    const appData = apps[name];
    const folderExists = fs.existsSync(appData.path);

    let memory = "n/a";
    let cpu = "n/a";

    if (appData.running && folderExists && appData.process?.pid) {
      try {
        const pid = appData.process.pid;
        const output = execSync(`ps -p ${pid} -o %cpu,rss --no-headers`).toString();
        const [cpuStr, memKb] = output.trim().split(/\s+/);
        cpu = cpuStr + "%";
        memory = (parseInt(memKb, 10) / 1024).toFixed(1) + " MB";
      } catch {}
    }

    status[name] = {
      port: appData.port,
      running: appData.running && folderExists,
      folderMissing: !folderExists,
      memory,
      cpu,
      startedAt: appData.startedAt || null,
    };
  }
  res.json(status);
});

// ---- List apps ----
app.get("/apps", (req, res) => {
  res.json(Object.keys(loadAppRegistry()));
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`${symbols.success} Koala server listening at http://localhost:${PORT}`);
});

// ---- Cleanup on exit ----
function cleanExit() {
  if (fs.existsSync(LOCKFILE)) fs.removeSync(LOCKFILE);
  process.exit(0);
}

process.on("SIGINT", cleanExit);
process.on("SIGTERM", cleanExit);
process.on("exit", () => {
  if (fs.existsSync(LOCKFILE)) fs.removeSync(LOCKFILE);
});
process.on("uncaughtException", (err) => {
  console.error(`${symbols.error} Uncaught exception: ${err.message}`);
  cleanExit();
});