import {
  LinkTypes,
  type BlastRadiusEntry,
  type IGraphStore,
} from "@workspace/contracts";
import { ImpactService as BaseImpactService } from "./impact.service.js";

/**
 * Phase 6 symbol/file bridge for statically proven file-level dependencies (#192).
 *
 * A process spawn or other file-level dependency naturally points at the executed file, while
 * callers ask `docuvia impact <symbol>` about symbols inside that file. The base service reports
 * only direct incoming edges to the symbol. This extension keeps that precise direct result and
 * additionally promotes incoming dependencies of the symbol's containing file into the symbol's
 * blast radius.
 *
 * This is not a transitive graph walk: only `file --contains--> symbol` plus one incoming edge to
 * that exact file is considered. Dynamic/unresolved dependencies remain outside this path and are
 * tracked by #393 rather than guessed.
 */
export class ImpactService extends BaseImpactService {
  public override getBlastRadius(
    store: IGraphStore,
    target: string,
  ): BlastRadiusEntry[] | undefined {
    const direct = super.getBlastRadius(store, target);
    if (!direct) return undefined;

    const node = store.graph.findNodeByName(target);
    if (!node) return direct;

    const seen = new Set(direct.map((entry) => entry.name));
    for (const container of store.graph
      .getIncomingRelations(node.id)
      .filter((relation) => relation.linkType === LinkTypes.CONTAINS)) {
      for (const dependent of store.graph.getIncomingRelations(container.id)) {
        if (dependent.linkType === LinkTypes.CONTAINS) continue;
        if (seen.has(dependent.name)) continue;
        direct.push(this.buildFileDependencyEntry(store, dependent));
        seen.add(dependent.name);
      }
    }

    return direct;
  }

  private buildFileDependencyEntry(
    store: IGraphStore,
    node: { id: number; name: string; type: string },
  ): BlastRadiusEntry {
    const l3Rows = store.l3.getByL2NodeId(node.id);
    const why =
      l3Rows.length > 0
        ? l3Rows.map((row) => ({ title: row.title, content: row.content }))
        : undefined;
    return why
      ? { name: node.name, type: node.type, why }
      : { name: node.name, type: node.type };
  }
}
