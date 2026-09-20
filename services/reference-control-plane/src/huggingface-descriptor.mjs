// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A model descriptor built from what a HuggingFace repository publishes about itself.
//
// Why this exists. `descriptors/import` accepts a document only when a publisher registered on
// this installation signed it, and that is the right rule: the digest every later guarantee
// rests on is a field of the document, so an unsigned one asks to be believed. But nobody signs
// NOESAR descriptors for the weights people actually want, so that rule left one honest path
// unbuilt and one dishonest path tempting -- signing other people's weights ourselves.
//
// There is a third way, and it keeps the guarantee whole. HuggingFace publishes, in its own API,
// the SHA-256 of every LFS file it stores (`lfs.oid`). Read it BEFORE the bytes are fetched and
// the acquisition is still a commitment made in advance: `fetchArtefact` streams under a byte
// ceiling and refuses by name the moment the digest disagrees. What changes is not the strength
// of the check but WHO made the promise -- a publisher's signature, or a publisher's API over
// TLS. So a descriptor built here says exactly that in `provenance`, and carries no `signature`,
// because inventing one would be the only actual lie available.
//
// Measured 2026-09-20 against the live API, which is why `lfs.oid` is relied on:
// `bartowski/microsoft_Phi-4-reasoning-GGUF` returns `lfs: { oid: "8f95954f...", size:
// 6913837024 }` for each GGUF, and `/api/models/<repo>` returns `cardData.license: "mit"`.
// A file with no `lfs` block is REFUSED rather than acquired without a digest. That refusal is
// the reason this file exists at all.
//
// Everything here is pure: the two documents are fetched by the caller and passed in, so the
// tests run offline with no fixture server -- the same shape `@noesar/verified-acquisition` uses.

export const HuggingFaceRefusal = {
  REPO_INVALID: 'HF_REPO_INVALID',
  FILE_NOT_NAMED: 'HF_FILE_NOT_NAMED',
  FILE_NOT_FOUND: 'HF_FILE_NOT_FOUND',
  NO_DIGEST: 'HF_NO_DIGEST',
  GATED: 'HF_GATED',
  NO_LICENSE: 'HF_NO_LICENSE',
};

const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** SHA-256 as HuggingFace writes it: 64 lowercase hex characters. */
const SHA256 = /^[0-9a-f]{64}$/;

function refuse(kind, reason) {
  return { ok: false, kind, reason };
}

/**
 * The two documents this needs, so the caller does the fetching and this file stays pure.
 * `tree/main` carries the digests; the model document carries the licence, which the tree
 * does not know.
 */
export function huggingFaceApiUrls(repository) {
  const repo = encodeURI(String(repository ?? ''));
  return {
    info: `https://huggingface.co/api/models/${repo}`,
    tree: `https://huggingface.co/api/models/${repo}/tree/main`,
    resolve: (file) => `https://huggingface.co/${repo}/resolve/main/${encodeURI(String(file ?? ''))}?download=true`,
  };
}

/** The GGUF files of a tree document, with the digest each one declares. */
export function listArtefacts(tree) {
  if (!Array.isArray(tree)) return [];
  return tree
    .filter((entry) => entry?.type === 'file' && /\.gguf$/i.test(String(entry.path ?? '')))
    .map((entry) => ({
      path: String(entry.path),
      sizeBytes: Number(entry.lfs?.size ?? entry.size ?? 0) || null,
      sha256: typeof entry.lfs?.oid === 'string' && SHA256.test(entry.lfs.oid) ? entry.lfs.oid : null,
    }));
}

/**
 * Build a descriptor for ONE file of ONE repository, or refuse it by name.
 *
 * `info` is `/api/models/<repo>` parsed, `tree` is `/api/models/<repo>/tree/main` parsed.
 */
export function buildDescriptorFromHuggingFace({ repository, file, info, tree, now = () => new Date() }) {
  const repo = String(repository ?? '').trim();
  if (!REPOSITORY.test(repo)) {
    return refuse(HuggingFaceRefusal.REPO_INVALID, `"${repo}" is not a HuggingFace repository of the form owner/name`);
  }
  const wanted = String(file ?? '').trim();
  if (!wanted) return refuse(HuggingFaceRefusal.FILE_NOT_NAMED, 'name which file of that repository to acquire');

  // A gated repository needs an access token this installation deliberately does not hold.
  // Saying so now is better than a 401 in the middle of a fifteen gigabyte download.
  if (info?.gated) {
    return refuse(HuggingFaceRefusal.GATED, `${repo} is gated: its publisher requires an access token, which this installation does not carry`);
  }

  const artefacts = listArtefacts(tree);
  const found = artefacts.find((entry) => entry.path === wanted);
  if (!found) {
    const names = artefacts.slice(0, 6).map((entry) => entry.path).join(', ');
    return refuse(
      HuggingFaceRefusal.FILE_NOT_FOUND,
      artefacts.length
        ? `${repo} has no file named "${wanted}". It carries: ${names}${artefacts.length > 6 ? ', ...' : ''}`
        : `${repo} publishes no .gguf file on its main branch`,
    );
  }

  // The refusal this whole file exists for. No digest would mean committing AFTER the bytes
  // arrive, and a commitment made afterwards is not a commitment.
  if (!found.sha256) {
    return refuse(
      HuggingFaceRefusal.NO_DIGEST,
      `${repo}/${wanted} is not stored as an LFS object, so its publisher declares no SHA-256 and there is nothing to hold the download to`,
    );
  }

  const license = info?.cardData?.license ?? info?.license ?? null;
  if (!license) {
    return refuse(HuggingFaceRefusal.NO_LICENSE, `${repo} declares no licence, and a model whose terms are unknown is not installed by implication`);
  }

  const urls = huggingFaceApiUrls(repo);
  const at = now().toISOString();

  return {
    ok: true,
    descriptor: {
      id: `${repo}/${wanted.replace(/\.gguf$/i, '')}`,
      version: typeof info?.sha === 'string' ? info.sha : String(info?.lastModified ?? at),
      publisher: repo.split('/')[0],
      source: urls.resolve(wanted),
      license: String(license),
      hashes: { sha256: found.sha256 },
      formats: ['gguf'],
      workloads: ['text'],
      resource_profiles: [{
        name: 'declared-by-file-size',
        // The only size anybody here measured. A parameter count is a repository's prose; this
        // is the number of bytes that will land on the disk.
        note: found.sizeBytes
          ? `${(found.sizeBytes / (1024 ** 3)).toFixed(2)} GiB on disk`
          : 'size not declared by the source',
      }],
      // No `signature` field. This is what says what was trusted instead, written so an operator
      // reading the stored document a year from now can tell the two kinds apart at a glance.
      provenance: {
        kind: 'publisher-api-digest',
        signed: false,
        digestFrom: urls.tree,
        describedBy: urls.info,
        retrievedAt: at,
        sizeBytes: found.sizeBytes,
        note: 'The SHA-256 was read from the publisher API before any byte was fetched, and the download is held to it. Nobody signed this document: what is trusted is the metadata HuggingFace published and the TLS connection that carried it.',
      },
    },
  };
}
