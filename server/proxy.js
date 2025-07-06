const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const http = require("http");
const vhost = require("vhost");

const app = express();
const koalaApps = {}; 

function registerApp(name, port) {
  koalaApps[name] = { port };
  console.log(`Registered: ${name}.localhost → :${port}`);
}

app.use(
  vhost("*.localhost", (req, res, next) => {
    const subdomain = req.hostname.split(".")[0];
    const app = koalaApps[subdomain];

    if (!app) {
      res.status(502).send(`No app deployed as "${subdomain}"`);
      return;
    }

    return createProxyMiddleware({
      target: `http://localhost:${app.port}`,
      changeOrigin: true,
      ws: true,
    })(req, res, next);
  })
);

app.get("/", (req, res) => {
  res.send("Koala Proxy running");
});

// --- Start proxy on port 80
http.createServer(app).listen(80, () => {
  console.log("🌐 Koala proxy running at http://*.localhost");
});

module.exports = { registerApp, koalaApps };
