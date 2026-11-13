async function readCatalog() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY || '';
  const branch = process.env.GITHUB_BRANCH;
  const [owner, repo, ...extraParts] = repository.split('/');
  if (!token || !branch || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || extraParts.length) {
    throw new Error('Falta configurar GITHUB_TOKEN, GITHUB_REPOSITORY o GITHUB_BRANCH para verificar el catálogo.');
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/catalog-data.json?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: ['Bearer', token].join(' '),
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Dulce-y-Feliz-catalog'
    }
  });
  const result = await response.json();
  if (!response.ok || !result.content) {
    console.error('Could not read current catalog', { status: response.status });
    throw new Error('No se pudo verificar el catálogo actual.');
  }

  let catalog;
  try {
    catalog = JSON.parse(Buffer.from(result.content, 'base64').toString('utf8'));
  } catch (error) {
    console.error('Invalid catalog JSON', error);
    throw new Error('El catálogo actual no tiene un formato válido.');
  }
  if (!Array.isArray(catalog.products)) throw new Error('El catálogo no contiene una lista de productos válida.');
  return catalog;
}

module.exports = { readCatalog };
