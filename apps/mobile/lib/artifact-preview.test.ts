import type { ArtifactVersion, ArtifactWithContent } from "@rakazo/contracts";
import { expect, it, vi } from "vitest";
import { loadArtifactPreview } from "./artifact-preview";

const versions = [
  { id: "root", version: 1 },
  { id: "new", version: 3 },
  { id: "middle", version: 2 },
] as ArtifactVersion[];
it("opens the latest file content even when the library link is the family root", async () => {
  const artifact = vi.fn(async (id: string) => ({ id }) as ArtifactWithContent);
  const result = await loadArtifactPreview("root", null, {
    versions: async () => versions,
    artifact,
  });
  expect(artifact).toHaveBeenCalledWith("new");
  expect(result.artifact.id).toBe("new");
});
it("honors an explicit historical version, rejecting selection from another family", async () => {
  const artifact = vi.fn(async (id: string) => ({ id }) as ArtifactWithContent);
  const load = { versions: async () => versions, artifact };
  await loadArtifactPreview("root", "middle", load);
  expect(artifact).toHaveBeenLastCalledWith("middle");
  await loadArtifactPreview("root", "foreign", load);
  expect(artifact).toHaveBeenLastCalledWith("new");
});
