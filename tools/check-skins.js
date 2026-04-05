const fs = require('fs');
const path = require('path');

function runCheckSkins(options = {}) {
  const logger = options.logger || console;
  const root = options.rootDir || process.cwd();
  const rendererRoot = path.join(root, 'src', 'renderer');
  const manifestPath = path.join(rendererRoot, 'skins', 'manifest.json');
  const contractPath = path.join(rendererRoot, 'skins', 'contract.json');
  const indexPath = path.join(rendererRoot, 'index.html');
  const errors = [];

  function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  function fail(message) {
    logger.error(`[check-skins] ERROR: ${message}`);
    errors.push(message);
  }

  function ok(message) {
    logger.log(`[check-skins] ${message}`);
  }

  function ensureFile(filePath, message) {
    if (!fs.existsSync(filePath)) {
      fail(`${message}: missing ${filePath}`);
      return false;
    }
    return true;
  }

  function ensureContains(filePath, pattern, message) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!pattern.test(content)) {
      fail(`${message}: expected pattern ${pattern} in ${filePath}`);
      return false;
    }
    return true;
  }

  if (!ensureFile(manifestPath, 'Manifest')) return { ok: false, errors };
  if (!ensureFile(contractPath, 'Contract')) return { ok: false, errors };
  if (!ensureFile(indexPath, 'Renderer index')) return { ok: false, errors };

  const manifest = readJson(manifestPath);
  const contract = readJson(contractPath);
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const skins = manifest.skins || [];

  if (!skins.length) fail('No skins declared in manifest.');
  if (!manifest.defaultSkinId) fail('defaultSkinId is not set.');

  const ids = new Set();
  for (const skin of skins) {
    if (!skin.id) {
      fail('Skin without id found.');
      continue;
    }
    if (ids.has(skin.id)) fail(`Duplicate skin id: ${skin.id}`);
    ids.add(skin.id);

    const themes = skin.supportedThemes || [];
    if (!themes.length) fail(`Skin "${skin.id}" has no supportedThemes.`);
    const skinBase = path.join(rendererRoot, 'skins', skin.id, 'skin.css');
    if (!ensureFile(skinBase, `Skin "${skin.id}" base stylesheet`)) continue;
    ensureContains(
      skinBase,
      /--skin-contract-id\s*:/,
      `Skin "${skin.id}" contract token declaration`
    );

    if (skin.compatible) {
      for (const theme of themes) {
        const themePath = path.join(rendererRoot, 'skins', skin.id, 'themes', `${theme}.css`);
        if (ensureFile(themePath, `Skin "${skin.id}" theme "${theme}"`)) {
          ensureContains(
            themePath,
            /--skin-theme-id\s*:/,
            `Skin "${skin.id}" theme "${theme}" token declaration`
          );
        }
      }
    }
  }

  if (!ids.has(manifest.defaultSkinId)) {
    fail(`defaultSkinId "${manifest.defaultSkinId}" is not present in skins[]`);
  }

  const requiredIds = contract.requiredIds || [];
  for (const id of requiredIds) {
    if (!indexHtml.includes(`id="${id}"`)) {
      fail(`Contract id "${id}" is missing from index.html`);
    }
  }

  if (!errors.length) {
    ok(`Validated ${skins.length} skins and ${requiredIds.length} contract IDs.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      skins: skins.length,
      requiredDomIds: requiredIds.length
    }
  };
}

if (require.main === module) {
  const result = runCheckSkins();
  if (!result.ok) {
    process.exitCode = 1;
  }
}

module.exports = { runCheckSkins };
