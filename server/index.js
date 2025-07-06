const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");
const { registerApp } = require("./proxy");
const { execSync } = require("child_process");
const app = express();
const PORT = 1993;

app.use(express.json());
app.use(require("cors")());

const apps = {}; // in-memory registry

// POST /deploy
app.post("/deploy", async (req, res) => {
  const { name, template, path: appPath } = req.body;

  const configPath = path.join(appPath, ".koala.json");
  if (!fs.existsSync(configPath)) {
    return res
      .status(400)
      .json({ success: false, message: ".koala.json not found" });
  }

  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const port = 3100 + Object.keys(apps).length;

  console.log(`🔧 [${name}] Running build...`);
  const build = spawn(config.build, { cwd: appPath, shell: true });

  let buildOutput = "";
  build.stdout.on("data", (data) => (buildOutput += data));
  build.stderr.on("data", (data) => (buildOutput += data));

  build.on("exit", (code) => {
    if (code !== 0) {
      console.error(`❌ Build failed:\n${buildOutput}`);
      return res.status(500).json({ success: false, message: "Build failed" });
    }

    console.log(`✅ Build complete:\n${buildOutput}`);
    console.log(`🚀 [${name}] Starting on port ${port}`);

    const logs = [];
    const child = spawn(config.start, {
      cwd: appPath,
      shell: true,
      env: { ...process.env, PORT: port },
    });

    child.stdout.on("data", (data) => {
      const line = `[${name}] ${data.toString()}`;
      logs.push(line);
      if (logs.length > 1000) logs.shift(); 
      process.stdout.write(line);
    });

    child.stderr.on("data", (data) => {
      const line = `[${name} ERROR] ${data.toString()}`;
      logs.push(line);
      if (logs.length > 1000) logs.shift();
      process.stderr.write(line);
    });

    apps[name] = {
      name,
      port,
      template,
      process: child,
      logs,
      running: true,
      path: appPath,
      start: config.start,
    };

    registerApp(name, port);

    res.json({
      success: true,
      message: `${name} running at http://${name}.localhost`,
      port,
    });
  });
});

app.post("/control/:name/stop", (req, res) => {
  const app = apps[req.params.name];
  if (!app || !app.process) {
    return res
      .status(404)
      .json({ error: `App "${req.params.name}" not found or not running.` });
  }
  app.process.kill();
  app.running = false;
  res.json({ success: true, message: `Stopped "${req.params.name}"` });
});

app.post("/control/:name/restart", (req, res) => {
  const app = apps[req.params.name];
  if (!app) {
    return res
      .status(404)
      .json({ error: `App "${req.params.name}" not found.` });
  }

  if (app.process) app.process.kill();

  const child = spawn(app.start, {
    cwd: app.path,
    shell: true,
    env: { ...process.env, PORT: app.port },
  });

  app.logs = [];
  app.running = true;
  app.process = child;

  child.stdout.on("data", (data) => {
    const line = `[${app.name}] ${data.toString()}`;
    app.logs.push(line);
    if (app.logs.length > 1000) app.logs.shift();
    process.stdout.write(line);
  });

  child.stderr.on("data", (data) => {
    const line = `[${app.name} ERROR] ${data.toString()}`;
    app.logs.push(line);
    if (app.logs.length > 1000) app.logs.shift();
    process.stderr.write(line);
  });

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

    let memory = "";
    let cpu = "";

    if (appData.running && folderExists && appData.process?.pid) {
      try {
        const pid = appData.process.pid;
        const output = execSync(
          `ps -p ${pid} -o %cpu,rss --no-headers`
        ).toString();
        const [cpuStr, memKb] = output.trim().split(/\s+/);
        cpu = cpuStr + "%";
        memory = (parseInt(memKb, 10) / 1024).toFixed(1) + " MB";
      } catch (e) {
        memory = "n/a";
        cpu = "n/a";
      }
    }

    status[name] = {
      port: appData.port,
      running: appData.running && folderExists,
      folderMissing: !folderExists,
      memory,
      cpu,
    };
  }
  res.json(status);
});

app.listen(PORT, () => {
  console.log(`🧪 Koala server listening at http://localhost:${PORT}`);
});
