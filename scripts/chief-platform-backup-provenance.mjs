/** Keep historical backup provenance distinct from a newly built candidate image. */
export function verifyBackupProvenance(backup, expected, inspectImage) {
  if (backup?.status !== 'passed' || backup.uuid !== expected.uuid || backup.slug !== expected.slug ||
      backup.sourceRevision !== expected.sourceRevision || !/^sha256:[a-f0-9]{64}$/.test(backup.images?.tool)) {
    throw Error('Exact workspace backup required.');
  }
  const image = inspectImage(backup.images.tool);
  if (image?.Id !== backup.images.tool || image.Config?.Labels?.['org.opencontainers.image.revision'] !== backup.sourceRevision) {
    throw Error('Original pinned backup tool is unavailable.');
  }
}
