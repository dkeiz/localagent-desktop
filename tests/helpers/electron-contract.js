const path = require('path');
const { spawn } = require('child_process');

function resolveElectronBinary() {
  const electron = require('electron');
  return typeof electron === 'string' ? electron : process.execPath;
}

async function runElectronScript(rootDir, relativeScriptPath) {
  const electronBinary = resolveElectronBinary();
  const scriptPath = path.join(rootDir, relativeScriptPath);
  const output = [];

  await new Promise((resolve, reject) => {
    const child = spawn(electronBinary, [scriptPath], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });

    child.stdout.on('data', chunk => output.push(String(chunk)));
    child.stderr.on('data', chunk => output.push(String(chunk)));
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(output.join('').trim() || `${relativeScriptPath} exited with code ${code}`));
    });
  });
}

module.exports = {
  runElectronScript
};
