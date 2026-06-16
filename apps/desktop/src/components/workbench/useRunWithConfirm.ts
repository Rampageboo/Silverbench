import { useCallback } from "react";
import { useConfirm } from "../useConfirm";
import type { ConfirmOptions } from "../confirmContext";

export function useRunWithConfirm() {
  const { confirm } = useConfirm();

  return useCallback(
    async (options: ConfirmOptions, run: () => void | Promise<void>) => {
      if (!(await confirm(options))) return false;
      await run();
      return true;
    },
    [confirm]
  );
}
