export interface CertificationSampleLocation {
  readonly sampleId: string;
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly calleeName: string;
}

export interface CertificationProofLocation {
  readonly filePath: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly calleeName: string;
}

function keyOf(location: CertificationProofLocation): string {
  return `${location.filePath}\0${location.startLine}\0${location.startColumn}\0${location.calleeName}`;
}

/** Split whole-source proofs by the sample locations sealed before oracle labeling. */
export function partitionProofSites<
  TProof extends CertificationProofLocation,
  TSample extends CertificationSampleLocation,
>(
  proofs: readonly TProof[],
  samples: readonly TSample[],
): {
  readonly inScope: readonly {
    readonly proof: TProof;
    readonly sample: TSample;
  }[];
  readonly outsideScope: readonly TProof[];
} {
  const sampleByLocation = new Map<string, TSample>();
  for (const sample of samples) {
    const key = keyOf({
      filePath: sample.filePath,
      startLine: sample.line,
      startColumn: sample.column,
      calleeName: sample.calleeName,
    });
    if (sampleByLocation.has(key))
      throw new Error(`Duplicate prelabel location: ${sample.sampleId}`);
    sampleByLocation.set(key, sample);
  }
  const inScope: { proof: TProof; sample: TSample }[] = [];
  const outsideScope: TProof[] = [];
  for (const proof of proofs) {
    const sample = sampleByLocation.get(keyOf(proof));
    if (sample) inScope.push({ proof, sample });
    else outsideScope.push(proof);
  }
  return { inScope, outsideScope };
}
