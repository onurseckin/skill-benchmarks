import { DockerClient } from "./docker-client.js";
import type { GCReport, IDockerClient } from "./types.js";

export interface GCOptions {
  readonly maxAgeMs?: number;
  readonly dryRun?: boolean;
}

export async function garbageCollectStaleResources(
  dockerClient: IDockerClient = new DockerClient(),
  options?: GCOptions,
): Promise<GCReport> {
  const startTime = Date.now();
  const maxAgeMs = options?.maxAgeMs ?? 3600000;
  const dryRun = options?.dryRun === true;

  const prunedContainers: string[] = [];
  const prunedVolumes: string[] = [];
  const errors: string[] = [];

  const now = Date.now();

  try {
    const containers = await dockerClient.listContainers({
      all: true,
      filters: {
        label: "io.skill-benchmarks.managed=true",
      },
    });

    for (const container of containers) {
      try {
        let isStale = false;
        if (container.created) {
          const createdTimestamp = new Date(container.created).getTime();
          if (!isNaN(createdTimestamp)) {
            isStale = now - createdTimestamp >= maxAgeMs;
          } else {
            isStale = true;
          }
        } else {
          isStale = true;
        }

        if (isStale) {
          if (!dryRun) {
            await dockerClient.killContainer(container.id).catch(() => {});
            await dockerClient.removeContainer(container.id, {
              force: true,
              removeVolumes: true,
            });
          }
          prunedContainers.push(container.id);
        }
      } catch (err) {
        const msg = `Failed to prune container ${container.id}: ${(err as Error).message}`;
        errors.push(msg);
      }
    }
  } catch (err) {
    const msg = `Failed to list managed containers during GC: ${(err as Error).message}`;
    errors.push(msg);
  }

  try {
    const volumes = await dockerClient.listVolumes({
      filters: {
        label: "io.skill-benchmarks.volume=workspace",
      },
    });

    for (const volume of volumes) {
      try {
        if (!dryRun) {
          await dockerClient.removeVolume(volume.name, { force: true });
        }
        prunedVolumes.push(volume.name);
      } catch (err) {
        const msg = `Failed to prune volume ${volume.name}: ${(err as Error).message}`;
        errors.push(msg);
      }
    }
  } catch (err) {
    const msg = `Failed to list workspace volumes during GC: ${(err as Error).message}`;
    errors.push(msg);
  }

  const durationMs = Date.now() - startTime;

  return {
    prunedContainers,
    prunedVolumes,
    errors,
    durationMs,
  };
}

if (import.meta.main) {
  console.log("Starting container and volume garbage collection...");
  const client = new DockerClient();
  garbageCollectStaleResources(client)
    .then((report) => {
      console.log(`GC completed in ${report.durationMs}ms.`);
      console.log(`- Containers pruned: ${report.prunedContainers.length}`);
      for (const id of report.prunedContainers) {
        console.log(`  • ${id}`);
      }
      console.log(`- Volumes pruned: ${report.prunedVolumes.length}`);
      for (const vol of report.prunedVolumes) {
        console.log(`  • ${vol}`);
      }
      if (report.errors.length > 0) {
        console.warn(`- Errors encountered: ${report.errors.length}`);
        for (const err of report.errors) {
          console.warn(`  ! ${err}`);
        }
      }
    })
    .catch((err) => {
      console.error("Fatal error during GC:", err);
      process.exit(1);
    });
}
