const path = require('path');
const fs = require('fs-extra');
const simpleGit = require('simple-git');
const axios = require('axios');

const KOALA_SERVER = 'http://localhost:1993'; // Update later

async function runApp(template, name) {
  const appPath = path.resolve(process.cwd());
  const appName = name;

  console.log(`🚀 Deploying "${appName}" using template "${template}"`);

  // Step 1: Load or create .koala.json
  const configPath = path.join(appPath, '.koala.json');
  let koalaConfig = {
    name: appName,
    type: template,
    build: 'npm install && npm run build',
    start: 'npm run start',
    port: 0
  };

  if (fs.existsSync(configPath)) {
    koalaConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } else {
    fs.writeFileSync(configPath, JSON.stringify(koalaConfig, null, 2));
    console.log('📄 Created default .koala.json');
  }

  // Step 2: Git commit
  const git = simpleGit(appPath);
  try {
    await git.init();
    await git.add('.');
    await git.commit(`Koala deploy: ${new Date().toISOString()}`);
  } catch (err) {
    console.warn('⚠️ Git error:', err.message);
  }

  // Step 3: Copy to a local folder for now
  const destDir = path.resolve(__dirname, '../../koala-apps', appName);
  await fs.ensureDir(destDir);
  await fs.copy(appPath, destDir);
  console.log(`📦 Project copied to local server dir: ${destDir}`);

  // Step 4: Notify server (later)
  try {
    const res = await axios.post(`${KOALA_SERVER}/deploy`, {
      name: appName,
      template,
      path: destDir
    });

    console.log(`🌍 Server says:`, res.data);
  } catch (err) {
    console.warn('⚠️ Skipping deploy request (server not running):', err.message);
  }
}

module.exports = { runApp };
