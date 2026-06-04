export type ScheduleType = "once" | "daily" | "weekly";

export interface ScheduledJob {
  id: string;
  name: string;
  prompt: string;
  cwd: string;
  profileName: string | null;
  provider: "anthropic" | "openai";
  model: string;
  scheduleType: ScheduleType;
  scheduleSpec: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: "idle" | "success" | "error" | "running";
  lastRunError?: string;
  nextRunAt?: string;
}

export interface SchedulerStore {
  jobs: ScheduledJob[];
}

export interface SchedulerRunRecord {
  id: string;
  jobId: string;
  startedAt: string;
  endedAt?: string;
  status: "success" | "error";
  sessionId?: string;
  summary?: string;
  error?: string;
}
