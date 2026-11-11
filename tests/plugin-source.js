// The plugin's own C++: a small core (main.cpp) and five parts (DMP-12), with Plugin.h between them. Source
// checks read them together, so a check finds its code whichever file holds it; pluginFile reads one.
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const PLUGIN_FILES = ['main.cpp', 'CardBridge.cpp', 'ReactionWiring.cpp', 'SaveLoad.cpp', 'HubAndApi.cpp', 'SelfTestRunner.cpp', 'Plugin.h'];

function pluginFile(file) {
  return fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');
}

function pluginFiles() {
  return PLUGIN_FILES.filter(file => fs.existsSync(path.join(SRC, file))).map(file => [file, pluginFile(file)]);
}

function pluginSource() {
  return pluginFiles().map(([, text]) => text).join('\n');
}

// one part's block, "namespace MiniPets::<name>" to its closing brace, from whichever file holds it
function pluginPart(name) {
  const marker = `namespace MiniPets::${name}\n`;
  for (const [, text] of pluginFiles()) {
    const at = text.indexOf(marker);
    if (at < 0) continue;
    const end = text.indexOf('\n}\n', at);
    return text.slice(at, end < 0 ? undefined : end + 2);
  }
  return '';
}

module.exports = { PLUGIN_FILES, pluginFile, pluginFiles, pluginSource, pluginPart };
