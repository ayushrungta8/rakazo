import type { ArtifactVersion, ArtifactWithContent } from "@rakazo/contracts";

export async function loadArtifactPreview(
  familyId: string,
  selectedId: string | null,
  load: {
    versions: (familyId: string) => Promise<ArtifactVersion[]>;
    artifact: (id: string) => Promise<ArtifactWithContent>;
  },
) {
  const versions = await load.versions(familyId);
  const latest = versions.reduce<ArtifactVersion | undefined>(
    (current, version) => (!current || version.version > current.version ? version : current),
    undefined,
  );
  const selected = versions.find((version) => version.id === selectedId);
  const artifact = await load.artifact(selected?.id ?? latest?.id ?? familyId);
  return { artifact, versions };
}
