import { useEffect } from "react";

type PollingJob = {
  id?: string;
  status?: string;
};

type UsePollingJobOptions<TJob extends PollingJob> = {
  job: TJob | null | undefined;
  pollMs: number;
  getJob: (jobId: string) => Promise<TJob>;
  onUpdate: (job: TJob) => void;
  onError: (error: unknown) => void;
  onTerminal?: (job: TJob) => void;
  isRunning?: (job: TJob) => boolean;
};

function defaultIsRunning<TJob extends PollingJob>(job: TJob) {
  return job.status === "running";
}

export function usePollingJob<TJob extends PollingJob>({
  job,
  pollMs,
  getJob,
  onUpdate,
  onError,
  onTerminal,
  isRunning = defaultIsRunning
}: UsePollingJobOptions<TJob>) {
  const jobId = job?.id;
  const jobIsRunning = Boolean(job && isRunning(job));

  useEffect(() => {
    if (!jobId || !jobIsRunning) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      getJob(jobId)
        .then((next) => {
          if (cancelled) return;
          onUpdate(next);
          if (!isRunning(next)) onTerminal?.(next);
        })
        .catch((error) => {
          if (!cancelled) onError(error);
        });
    }, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [getJob, isRunning, jobId, jobIsRunning, onError, onTerminal, onUpdate, pollMs]);
}
