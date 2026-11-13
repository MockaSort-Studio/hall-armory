// Every bound the suite enforces, in one place. Each is a hard refusal, never a truncation of what is installed.
export const LIMITS = {
  lockfileBytes: 16 * 1024 * 1024,
  tarballBytes: 32 * 1024 * 1024, // one downloaded archive
  packageUnpackedBytes: 128 * 1024 * 1024, // one archive after gunzip
  totalUnpackedBytes: 256 * 1024 * 1024, // everything one install writes
  totalEntries: 20000, // files and directories one install writes
  packages: 4000,
  pathBytes: 1024,
  auditResponseBytes: 8 * 1024 * 1024,
  auditBatch: 500,
  auditItems: 200,
  auditText: 300,
  fetchMs: 60000,
} as const;

export const REGISTRY_HOST = "registry.npmjs.org";
