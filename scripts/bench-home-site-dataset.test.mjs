import { test } from 'node:test';
import assert from 'node:assert/strict';

test('function sections preserve source and bind relevance to the matching section', async () => {
  const { createDataset } = await import('./bench-home-site-dataset.mjs');
  const result = createDataset({ 'src/App.jsx': 'const X = 1;\nfunction Navbar() { return "Escape"; }\nfunction Kontakt() { return "demo"; }' }, [
    { text: 'Where does Escape close navigation?', path: 'src/App.jsx', section: 'function Navbar(' },
  ]);
  assert.equal(result.documents.length, 3);
  assert.equal(result.documents[1].text, 'src/App.jsx\nfunction Navbar() { return "Escape"; }\n');
  assert.deepEqual(result.queries[0].relevantIds, ['src/App.jsx#1']);
});

test('missing expected source section rejects rather than inventing benchmark truth', async () => {
  const { createDataset } = await import('./bench-home-site-dataset.mjs');
  assert.throws(() => createDataset({ 'src/App.jsx': 'function Navbar() {}' }, [
    { text: 'Contact', path: 'src/App.jsx', section: 'function Kontakt(' },
  ]), /MISSING_SECTION/);
});
