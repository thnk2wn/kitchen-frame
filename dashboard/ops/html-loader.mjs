// Test-only: lets Node import page.html as text, the way wrangler bundles it (rules: Text).
import { readFile } from 'node:fs/promises';
export async function load(url, context, next) {
  if (url.endsWith('.html')) return { format: 'module', shortCircuit: true, source: 'export default ' + JSON.stringify(await readFile(new URL(url), 'utf8')) + ';' };
  return next(url, context);
}
