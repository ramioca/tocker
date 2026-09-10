import type { DataSourceInfo } from "@/server/types";

/**
 * PLACEHOLDER — owned by the RUNTIME workstream.
 *
 * Foundation needs this module to exist so `listDataSources()` type-checks and
 * builds before the branches are merged. At merge time keep RUNTIME's version of
 * this file (the real registry with `query(params)` per source); the only thing
 * foundation depends on is the exported `DATA_SOURCES` array of `DataSourceInfo`.
 */
export const DATA_SOURCES: DataSourceInfo[] = [];
