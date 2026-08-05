# Decisions

Confirmed by specification v0.2:

- VRMA and BVH are co-equal P0 future exporters.
- Blender is an adapter and review surface, not the compute host or data truth.
- Four-direction recordings must be phase-aligned and jointly solved, never
  solved independently and averaged.

Pending later milestone review:

- Exact motion prior, DTW versus soft-DTW, FBX implementation, and real-time UI.
