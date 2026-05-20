import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SnapshotMeta {
  readonly kind: string;
  readonly tag: string;
}

export class SnapshotStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  write(meta: SnapshotMeta, payload: unknown): string {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(this.root, meta.kind, `${ts}__${meta.tag}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
    return path;
  }
}
