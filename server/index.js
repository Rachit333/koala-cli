const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { registerApp, proxyMiddleware } = require("./proxy");
const net = require("net");
const chalk = require("chalk");
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

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
  console.error(
    `${symbols.error} Koala server already running (lockfile exists)`
  );
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
      pid: data.pid || null, // ✅ Persist PID
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

function isPortInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") resolve(true);
      else resolve(false);
    });
    server.once("listening", () => server.close(() => resolve(false)));
    server.listen(port, host);
  });
}

app.use(proxyMiddleware);

// ---- App launching ----
async function launchApp(meta) {
  const portInUse = await isPortInUse(meta.port);
  if (portInUse) {
    console.warn(
      `${symbols.warn} Port ${meta.port} already in use. Skipping ${meta.name}`
    );
    if (apps[meta.name]) {
      apps[meta.name].running = false;
    }
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

  // Set app as launching, not yet running
  apps[meta.name] = {
    ...meta,
    logs,
    process: child,
    pid: child.pid, // ✅ Save PID
    running: false,
    startedAt: new Date().toISOString(),
  };

  registerApp(meta.name, meta.port);

  // ✅ Wait for port to become available (up to 3s)
  for (let i = 0; i < 30; i++) {
    if (await isPortInUse(meta.port)) {
      apps[meta.name].running = true;
      saveAppRegistry(); // Save registry with PID
      return;
    }
    await wait(100);
  }

  // ❌ App failed to start properly
  console.warn(
    `${symbols.warn} App ${meta.name} failed to bind to port ${meta.port} in time`
  );
  child.kill();
  apps[meta.name].running = false;
  saveAppRegistry();
}

// ---- Restore saved apps ----
(async () => {
  const savedApps = loadAppRegistry();
  for (const [name, meta] of Object.entries(savedApps)) {
    if (!fs.existsSync(meta.path)) {
      console.warn(`${symbols.warn} Skipping restore: ${name} folder missing`);
      continue;
    }
    console.log(`${symbols.info} Restoring ${name} on port ${meta.port}`);
    await launchApp(meta);
  }
})();

// ---- Deploy endpoint ----
app.post("/deploy", async (req, res) => {
  const { name, template, path: appPath } = req.body;
  const configPath = path.join(appPath, ".koala.json");

  if (!fs.existsSync(configPath)) {
    return res
      .status(400)
      .json({ success: false, message: ".koala.json not found" });
  }

  const config = JSON.parse(await fs.readFile(configPath, "utf8"));

  if (!config.build || !config.start) {
    return res
      .status(400)
      .json({ success: false, message: "Missing build/start in config" });
  }

  let port = 3100;
  while (await isPortInUse(port)) {
    console.log(`${symbols.warn} Port ${port} is in use, trying next...`);
    port++;
  }

  console.log(`${symbols.info} [${name}] Running build...`);
  const build = spawn(config.build, { cwd: appPath, shell: true });

  let buildOutput = "";
  build.stdout.on("data", (data) => (buildOutput += data));
  build.stderr.on("data", (data) => (buildOutput += data));

  build.on("exit", async (code) => {
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

    await launchApp(meta);
    saveAppRegistry();

    res.json({
      success: true,
      message: `${name} running at http://${name}.localhost`,
      port,
    });
  });
});

// ---- Control endpoints ----
app.post("/control/:name/stop", async (req, res) => {
  const app = apps[req.params.name];

  if (!app) {
    return res
      .status(404)
      .json({ error: `App "${req.params.name}" not found.` });
  }

  let killed = false;

  // Try to stop using stored process object
  if (app.process) {
    app.process.kill();
    killed = true;
  } else {
    // Fallback: try to kill anything bound to the app's port
    try {
      const pid = execSync(`lsof -t -i:${app.port} -sTCP:LISTEN`)
        .toString()
        .trim();

      if (pid) {
        execSync(`kill -9 ${pid}`);
        console.warn(
          `${symbols.warn} Force-killed orphan process using port ${app.port} (PID ${pid})`
        );
        killed = true;
      }
    } catch (err) {
      console.warn(
        `${symbols.warn} No PID found for port ${app.port} during stop`
      );
    }
  }

  app.running = false;
  app.process = null;
  app.pid = null; // ✅ Optional: only needed if you persist pid
  saveAppRegistry();

  if (killed) {
    return res.json({
      success: true,
      message: `Stopped "${req.params.name}"`,
    });
  } else {
    return res.json({
      success: false,
      message: `"${req.params.name}" was not running.`,
    });
  }
});

app.post("/control/:name/restart", async (req, res) => {
  const existing = apps[req.params.name];
  if (!existing) {
    return res
      .status(404)
      .json({ error: `App "${req.params.name}" not found.` });
  }

  if (existing.process) existing.process.kill();
  apps[req.params.name].running = false;

  // Wait up to 2s for port to free, else force-kill anything bound to it
  for (let i = 0; i < 20; i++) {
    if (!(await isPortInUse(existing.port))) break;
    await wait(100);
  }

  // Final check
  if (await isPortInUse(existing.port)) {
    console.warn(
      `${symbols.warn} Port ${existing.port} still in use after waiting. Attempting forced kill...`
    );
    try {
      // Find and kill any process using the port
      const pid = execSync(`lsof -t -i:${existing.port} -sTCP:LISTEN`)
        .toString()
        .trim();

      if (pid) {
        execSync(`kill -9 ${pid}`);
        console.log(
          `${symbols.warn} Force-killed PID ${pid} using port ${existing.port}`
        );
        await wait(300); // Wait a bit for port to actually release
      }
    } catch (e) {
      console.error(
        `${symbols.error} Failed to force-kill port ${existing.port}: ${e.message}`
      );
      return res.status(500).json({
        error: `Port ${existing.port} still in use. Restart aborted.`,
      });
    }
  }

  await launchApp(existing);
  saveAppRegistry();

  res.json({ success: true, message: `Restarted "${existing.name}"` });
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
        const output = execSync(
          `ps -p ${pid} -o %cpu,rss --no-headers`
        ).toString();
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
  console.log(
    `${symbols.success} Koala server listening at http://localhost:${PORT}`
  );
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
