"""Per-video auxiliary-expert cadence; never skips base observations or output frames."""
from __future__ import annotations

import math
from dataclasses import dataclass

EXPERT_INTERVALS = ("1", "2", "3", "auto")
BODY_JOINTS = tuple(range(5, 17))


@dataclass(frozen=True)
class ExpertDecision:
    run: bool
    interval: int
    reasons: tuple[str, ...]


class ExpertScheduler:
    """Risk thresholds are conservative heuristics, not calibrated accuracy claims.

    None preserves the existing quality-mode scheduling at the caller. Explicit
    modes control auxiliary experts, while 'fast' still disables those models.
    Construct one scheduler per video, even when models are shared across views.
    """

    def __init__(self, mode: str | None, quality: str, fps: float) -> None:
        if mode is not None and mode not in EXPERT_INTERVALS:
            raise ValueError("expert interval must be 1, 2, 3 or auto")
        if quality not in ("fast", "balanced", "maximum"):
            raise ValueError("unknown pose quality mode")
        if not math.isfinite(fps) or fps <= 0:
            raise ValueError("scheduler fps must be positive and finite")
        self.mode, self.quality, self.fps = mode, quality, fps
        self.previous: dict[int, tuple[float, float]] = {}
        self.velocity: dict[int, tuple[float, float]] = {}
        self.previous_frame: int | None = None
        self.last_run: int | None = None
        self.risk_until = -1
        self.calm_frames = 0

    def report_expert_risk(self, frame: int) -> None:
        """Failed or conflicting checks keep subsequent frames dense."""
        if frame != self.previous_frame:
            raise ValueError("expert feedback must match the last observed frame")
        self.risk_until = max(self.risk_until, frame + max(2, math.ceil(self.fps * 0.1)))
        self.calm_frames = 0

    def observe(
        self, frame: int, points: list[list[float]], scores: list[float],
        tracking_failed: bool = False,
    ) -> ExpertDecision:
        if frame < 0 or (self.previous_frame is not None and frame <= self.previous_frame):
            raise ValueError("scheduler frames must increase; use a fresh scheduler per video")
        current: dict[int, tuple[float, float]] = {}
        low_confidence = False
        for joint in BODY_JOINTS:
            if joint >= len(points) or joint >= len(scores) or len(points[joint]) < 2:
                low_confidence = True
                continue
            score = float(scores[joint])
            x, y = float(points[joint][0]), float(points[joint][1])
            if not all(math.isfinite(v) for v in (score, x, y)) or score < 0.70:
                low_confidence = True
            if all(math.isfinite(v) for v in (x, y, score)) and score >= 0.45:
                current[joint] = (x, y)

        reasons: list[str] = []
        if low_confidence:
            reasons.append("low-confidence-or-missing")
        if tracking_failed:
            reasons.append("tracking-failure")
        consecutive = self.previous_frame is not None and frame == self.previous_frame + 1
        velocities: dict[int, tuple[float, float]] = {}
        if consecutive and current and self.previous:
            # Torso scale avoids measuring speed against a large video/ROI background.
            torso = [current[j] for j in (5, 6, 11, 12) if j in current]
            if len(torso) < 3:
                torso = list(current.values())
            scale = max(20.0, math.hypot(
                max(p[0] for p in torso) - min(p[0] for p in torso),
                max(p[1] for p in torso) - min(p[1] for p in torso),
            ))
            speed = acceleration = 0.0
            for joint, point in current.items():
                if joint not in self.previous:
                    continue
                velocity = tuple((point[k] - self.previous[joint][k]) * self.fps / 30.0 for k in (0, 1))
                velocities[joint] = velocity
                speed = max(speed, math.hypot(*velocity) / scale)
                if joint in self.velocity:
                    acceleration = max(acceleration, math.hypot(
                        velocity[0] - self.velocity[joint][0],
                        velocity[1] - self.velocity[joint][1],
                    ) * self.fps / 30.0 / scale)
            if speed > 0.08:
                reasons.append("fast-motion")
            if acceleration > 0.06:
                reasons.append("abrupt-motion")
        if not consecutive:
            reasons.append("initial-or-discontinuous-frame")
        self.previous, self.velocity, self.previous_frame = current, velocities, frame
        if reasons:
            # Keep dense checks for roughly 100 ms after a warning clears.
            self.risk_until = frame + max(2, math.ceil(self.fps * 0.1))
            self.calm_frames = 0
        else:
            self.calm_frames += 1
            if frame <= self.risk_until:
                reasons.append("risk-hold")
        interval = (3 if self.calm_frames >= max(8, math.ceil(self.fps * 0.25)) else 2) \
            if self.mode == "auto" else int(self.mode or "1")
        if self.quality == "fast":
            return ExpertDecision(False, interval, ("fast-mode-disabled",))
        if self.mode is None:
            return ExpertDecision(False, interval, ("legacy-quality-policy",))
        due = self.last_run is None or frame - self.last_run >= interval
        run = bool(reasons) or due
        if run:
            self.last_run = frame
        return ExpertDecision(run, interval, tuple(reasons or ["interval-due" if due else "interval-skip"]))
