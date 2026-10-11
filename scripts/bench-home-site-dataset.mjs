import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createDataset(files, cases) {
  const documents = Object.entries(files).flatMap(([path, source]) => source.split(/(?=^(?:function |export default function |const [A-Z_]+ = |@media ))/m)
    .filter(text => text.trim()).map((text, i) => ({ id: `${path}#${i}`, text: `${path}\n${text}` })));
  const queries = cases.map(({ text, path, section }) => {
    const relevant = documents.filter(doc => doc.id.startsWith(`${path}#`) && doc.text.includes(section));
    if (relevant.length !== 1) throw new Error(`MISSING_SECTION:${path}:${section}`);
    return { text, relevantIds: relevant.map(doc => doc.id) };
  });
  return { documents, queries, boundary: 'Small HomeSite source retrieval corpus; not a representative multimodal benchmark' };
}

const cases = [
  ['Gdzie menu mobilne obsługuje Escape i przywraca fokus do przycisku?', 'src/App.jsx', 'function Navbar('],
  ['Where does mobile navigation trap the Tab key and move initial focus?', 'src/App.jsx', 'function Navbar('],
  ['Który komponent sprawdza przewijanie strony i zmienia nawigację?', 'src/App.jsx', 'function Navbar('],
  ['Gdzie formularz waliduje adres email i wskazuje błędne pola?', 'src/App.jsx', 'function Kontakt('],
  ['Does the contact form send a real network request or only show a demo confirmation?', 'src/App.jsx', 'function Kontakt('],
  ['Gdzie są aria-invalid i aria-describedby pól kontaktowych?', 'src/App.jsx', 'function Kontakt('],
  ['Jakie usługi oferuje firma: chmura, bezpieczeństwo i automatyzacja?', 'src/App.jsx', 'const USLUGI ='],
  ['What is the technology stack of FashionStore and MediFlow?', 'src/App.jsx', 'const REALIZACJE ='],
  ['Gdzie są dane projektu FinScope wykorzystującego Python i Kubernetes?', 'src/App.jsx', 'const REALIZACJE ='],
  ['Which component renders the company hero statistics?', 'src/App.jsx', 'function Hero('],
  ['Gdzie renderowana jest siatka usług firmy?', 'src/App.jsx', 'function Uslugi('],
  ['Which component renders case study cards?', 'src/App.jsx', 'function Realizacje('],
  ['Gdzie wyświetlana jest opinia klienta?', 'src/App.jsx', 'function Opinia('],
  ['Where are the footer contact address and fictional company disclaimer?', 'src/App.jsx', 'function Stopka('],
  ['Który komponent zawiera skip link i główną strukturę strony?', 'src/App.jsx', 'export default function App('],
  ['Jakie sekcje są zdefiniowane w linkach menu?', 'src/App.jsx', 'const LINKI_NAV ='],
  ['Where are mobile layout rules for screens up to 640 pixels?', 'src/styles.css', '@media (max-width: 640px)'],
  ['Gdzie są reguły układu tabletowego do 900px?', 'src/styles.css', '@media (max-width: 900px)'],
  ['Where is reduced motion supported in CSS?', 'src/styles.css', '@media (prefers-reduced-motion: reduce)'],
  ['Gdzie jest obsługiwany najmniejszy ekran 360px?', 'src/styles.css', '@media (max-width: 360px)'],
  ['Which React and Vite versions and build script does the project use?', 'package.json', '"scripts"'],
  ['Gdzie createRoot uruchamia aplikację w StrictMode?', 'src/main.jsx', 'createRoot'],
  ['Which HTML file provides the root mounting element?', 'index.html', 'id="root"'],
].map(([text, path, section]) => ({ text, path, section }));

async function main() {
  const [root, output] = process.argv.slice(2);
  if (!root || !output) throw new Error('Usage: node scripts/bench-home-site-dataset.mjs PROJECT_ROOT OUTPUT.json');
  const paths = ['src/App.jsx', 'src/styles.css', 'src/main.jsx', 'package.json', 'index.html'];
  const files = Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(join(root, path), 'utf8')])));
  const dataset = createDataset(files, cases);
  await writeFile(output, JSON.stringify(dataset, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ documents: dataset.documents.length, queries: dataset.queries.length, output }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
