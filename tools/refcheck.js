// Every id the script reaches for must exist somewhere: either in the static
// HTML, or in a template literal that injects it at runtime.
const fs = require('fs');
const path = process.env.METAR_HTML ||
  require('path').join(__dirname, '..', 'metar-tutorial_3.html');
const html = fs.readFileSync(path, 'utf8');
const scriptStart = html.indexOf('<script>');
const staticHtml = html.slice(0, scriptStart);
const js = html.slice(scriptStart + 8, html.lastIndexOf('</script>'));

const staticIds = new Set([...staticHtml.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
// ids created at runtime by the script itself
const runtimeIds = new Set([...js.matchAll(/\bid="([A-Za-z][\w-]*)"/g)].map(m => m[1]));

const referenced = new Set();
for (const m of js.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) referenced.add(m[1]);
for (const m of js.matchAll(/querySelector(?:All)?\(\s*'#([\w-]+)'/g)) referenced.add(m[1]);
// el('x') shorthand used inside PROGRESS/builder
for (const m of js.matchAll(/\bel\(\s*'([\w-]+)'\s*\)/g)) referenced.add(m[1]);

const missing = [...referenced].filter(id => !staticIds.has(id) && !runtimeIds.has(id));
const unusedStatic = [...staticIds].filter(id => !referenced.has(id) &&
  !js.includes(`'${id}'`) && !html.includes(`href="#${id}"`) && !html.includes(`for="${id}"`) &&
  !html.includes(`aria-controls="${id}"`) && !html.includes(`panel-`));

console.log('static ids:            ' + staticIds.size);
console.log('runtime-created ids:   ' + runtimeIds.size);
console.log('ids referenced by JS:  ' + referenced.size);
console.log('\nreferenced but never defined anywhere:');
console.log(missing.length ? missing.map(m => '  MISSING #' + m).join('\n') : '  (none)');
console.log('\nstatic ids with no JS reference and no anchor/label link:');
console.log(unusedStatic.length ? unusedStatic.map(m => '  unused #' + m).join('\n') : '  (none)');
process.exit(missing.length ? 1 : 0);
