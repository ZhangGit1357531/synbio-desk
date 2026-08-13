# SynBio Desk

Static chemical-biology literature workspace for GitHub Pages.

## Deployment

1. Create a GitHub repository and upload this directory.
2. Set **Settings -> Pages -> Source** to **GitHub Actions**.
3. Run **Actions -> Update weekly literature -> Run workflow** once to generate the first real `data/data.json`.
4. The Pages workflow deploys the site on every push. The weekly workflow runs every Monday at 01:15 UTC and commits fresh Crossref/bioRxiv records.

No sample or fabricated papers are included. If the public APIs return no matching records, the site shows an empty state.
