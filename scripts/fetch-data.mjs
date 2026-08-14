import fs from 'node:fs/promises';

const journals = [
  ['Nature', '0028-0836'],
  ['Nature Chemistry', '1755-4330'],
  ['Nature Structural & Molecular Biology', '1545-7885'],
  ['Nature Biotechnology', '1087-0156'],
  ['Nature Chemical Biology', '1552-4450'],
  ['Science', '0036-8075'],
  ['Science Advances', '2375-2548'],
  ['Cell', '0092-8674'],
  ['JACS', '0002-7863'],
  ['Angewandte Chemie', '1433-7851'],
  ['Chemical Science', '2041-6539'],
  ['Journal of Biological Chemistry', '0021-9258'],
  ['Nucleic Acids Research', '0305-1048'],
];

const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 120);
const doiPattern = /^10\.\d{4,9}\/[\S]+$/i;
const clean = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const topic = ({ title, abstract }) => {
  const heading = String(title || '').toLowerCase();
  if (/(rna|ribozyme|circular rna|oligonucleotide).{0,45}(ligase|ligation)|(?:ligase|ligation).{0,45}(rna|ribozyme|circular rna|oligonucleotide)/i.test(heading)) return 'ligase';
  if (/(template[- ]?(free|independent)|non[- ]template|terminal transferase|rna synthesis|dna synthesis|oligonucleotide synthesis|nucleotide polymerase|polymerase engineering|ribozyme synthesis|enzymatic nucleic acid)/i.test(heading)) return 'rna';
  if (/(enzymatic synthesis|biocatalytic|biocatalysis|biosynthetic|biosynthesis|de novo synthesis|cell[- ]free synthesis|enzyme engineering|glycosyltransferase|natural product biosynthesis|enzyme cascade)/i.test(heading)) return 'molecule';
  return null;
};
const relevant = ({ title, abstract }) => {
  if (/editorial|correction|erratum|commentary|perspective|news|obituary|meeting|protocol/i.test(title)) return false;
  return Boolean(topic({ title, abstract })) || /(template[- ]free|template[- ]independent|rna synthesis|dna synthesis|oligonucleotide synthesis|enzymatic synthesis|biocatalytic|biocatalysis|biosynthesis|polymerase engineering|rna ligase|ribozyme)/i.test(`${title} ${abstract}`);
};
const preprintTopic = ({ title, abstract }) => topic({ title, abstract }) || (/(template[- ]?free|template[- ]?independent|rna synthesis|dna synthesis|oligonucleotide|ribozyme|polymerase)/i.test(`${title} ${abstract}`) ? 'rna' : 'molecule');
const score = ({ title, abstract }) => {
  const s = `${title} ${abstract}`.toLowerCase();
  return Math.min(99, 72 + ['enzyme', 'enzymatic', 'biosynth', 'polymerase', 'rna', 'dna', 'ligase', 'template-free', 'de novo', 'biocatal'].filter(k => s.includes(k)).length * 3);
};
const pubDate = item => {
  const parts = (item.published || item['published-print'] || item['published-online'])?.['date-parts']?.[0];
  return parts ? parts.join('-') : '';
};
const realUrl = item => item.DOI ? `https://doi.org/${item.DOI}` : (/^https?:\/\//.test(item.URL || '') ? item.URL : '');
const normalizeDoi = value => String(value || '').replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:\s*/i, '').trim().replace(/[.,;]+$/, '');

async function crossref([journal, issn]) {
  const params = new URLSearchParams({
    filter: `from-pub-date:${cutoff.toISOString().slice(0, 10)},until-pub-date:${new Date().toISOString().slice(0, 10)},type:journal-article`,
    sort: 'published', order: 'desc', rows: '30',
  });
  const response = await fetch(`https://api.crossref.org/journals/${issn}/works?${params}`, { headers: { Accept: 'application/json', 'User-Agent': 'SynBioDesk/1.0 (weekly literature updater)' } });
  if (!response.ok) throw new Error(`Crossref ${journal}: ${response.status}`);
  const items = (await response.json()).message?.items || [];
  return items.map((item, index) => {
    const title = clean(item.title?.[0]);
    const abstract = clean(item.abstract) || 'Publisher record available. Open the article page for the full abstract.';
    const t = topic({ title, abstract });
    const doi = normalizeDoi(item.DOI);
    const url = doiPattern.test(doi) ? `https://doi.org/${doi}` : realUrl(item);
    if (!title || !doiPattern.test(doi) || !url || !t || !relevant({ title, abstract })) return null;
    return { id: `crossref-${issn}-${index}`, journal, title, abstract, topic: t, topicLabel: t === 'rna' ? 'RNA / DNA' : t === 'ligase' ? 'RNA ligase' : 'Molecular synthesis', score: score({ title, abstract }), date: pubDate(item), authors: (item.author || []).slice(0, 3).map(a => `${a.given || ''} ${a.family || ''}`.trim()).join(' · ') || 'Authors listed by publisher', url, doi };
  }).filter(Boolean);
}

async function biorxiv() {
  const start = new Date(Date.now() - 1000 * 60 * 60 * 24 * 120).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  const response = await fetch(`https://api.biorxiv.org/details/biorxiv/${start}/${end}/0`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`bioRxiv: ${response.status}`);
  return ((await response.json()).collection || []).filter(item => doiPattern.test(normalizeDoi(item.doi)) && relevant({ title: item.title, abstract: item.abstract || '' })).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3).map((item, index) => { const doi = normalizeDoi(item.doi); return { num: String(index + 1).padStart(2, '0'), title: item.title, meta: `bioRxiv · ${item.date}`, topic: preprintTopic({ title: item.title, abstract: item.abstract || '' }), url: `https://doi.org/${doi}`, doi }; });
}

const results = await Promise.allSettled(journals.map(crossref));
const rejectedSources = results.flatMap((result, index) => result.status === 'rejected' ? [journals[index][0]] : []);
const fulfilledSources = results.filter(result => result.status === 'fulfilled').length;
const candidates = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
const articles = [...new Map(candidates.map(item => [item.doi.toLowerCase(), item])).values()].sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, 10);
let preprints = [];
try { preprints = await biorxiv(); } catch (error) { console.warn(error.message); }
let previous = null;
try { previous = JSON.parse(await fs.readFile('data/data.json', 'utf8')); } catch {}
if (!articles.length && fulfilledSources === 0 && previous?.articles?.length) {
  console.warn('No verified journal records returned; keeping previous data.');
  process.exit(0);
}
await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/data.json', JSON.stringify({ generatedAt: new Date().toISOString(), source: 'Crossref + bioRxiv public APIs', verified: true, rejectedSources, articles, preprints }, null, 2));
console.log(`Wrote ${articles.length} articles and ${preprints.length} preprints.`);
