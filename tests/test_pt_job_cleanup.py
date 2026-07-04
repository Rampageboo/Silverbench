from __future__ import annotations

import unittest

from backend.job_store import JobStore
from backend.service import _PT_JOB_TTL_SECONDS


class PtJobCleanupTests(unittest.TestCase):
    def test_prune_keeps_running_and_fresh_jobs(self) -> None:
        store = JobStore(not_found_message="PT job not found.", ttl_seconds=_PT_JOB_TTL_SECONDS)
        running_id, _ = store.create({"status": "running"})
        fresh_id, _ = store.create({"status": "running"})
        expired_id, _ = store.create({"status": "running"})

        store.finish(fresh_id, {"status": "done"})
        store.finish(expired_id, {"status": "error"})
        with store._lock:
            store._jobs[expired_id]["finishedAt"] -= _PT_JOB_TTL_SECONDS + 1

        self.assertEqual(store.snapshot(running_id)["status"], "running")
        self.assertEqual(store.snapshot(fresh_id)["status"], "done")
        with self.assertRaisesRegex(ValueError, "PT job not found."):
            store.snapshot(expired_id)

    def test_cancel_sets_cancel_event_and_hides_internal_state(self) -> None:
        store = JobStore(not_found_message="PT job not found.")
        job_id, cancel_event = store.create({"status": "running", "detail": "Starting..."}, cancelable=True)

        snapshot = store.cancel(job_id)

        self.assertIsNotNone(cancel_event)
        self.assertTrue(cancel_event.is_set())
        self.assertEqual(snapshot["detail"], "Cancelling...")
        self.assertNotIn("cancelEvent", snapshot)
        self.assertNotIn("finishedAt", snapshot)


if __name__ == "__main__":
    unittest.main()
