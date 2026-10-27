import { create } from "zustand";

import { captureApi } from "@/api";
import type { CaptureStatus } from "@/types/domain";

const IDLE: CaptureStatus = { state: "idle", projectId: null, captured: 0, browserVersion: null };

interface CaptureStore {
  status: CaptureStatus;
  setStatus: (status: CaptureStatus) => void;
  refresh: () => Promise<void>;
}

export const useCaptureStore = create<CaptureStore>((set) => ({
  status: IDLE,
  setStatus: (status) => set({ status }),
  refresh: async () => set({ status: await captureApi.status() }),
}));
