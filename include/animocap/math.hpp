#pragma once

#include "animocap/skeleton.hpp"
#include "animocap/types.hpp"

#include <vector>

namespace animocap {

double quat_norm(const Quat& value);
Quat normalize(const Quat& value);
Quat conjugate(const Quat& value);
Quat multiply(const Quat& lhs, const Quat& rhs);
Quat from_axis_angle(const Vec3& axis, double radians);
Vec3 rotate(const Quat& rotation, const Vec3& point);
void enforce_quaternion_continuity(std::vector<Quat>& values);

Vec3 canonical_to_blender(const Vec3& value);
Vec3 blender_to_canonical(const Vec3& value);
Quat canonical_to_blender(const Quat& value);
Quat blender_to_canonical(const Quat& value);

struct FKResult {
    std::vector<Vec3> positions_m;
    std::vector<Quat> global_rotations;
};

FKResult forward_kinematics(
    const Skeleton& skeleton,
    const std::vector<Quat>& local_rotations,
    const Vec3& scene_root_translation_m,
    const Vec3& hips_translation_m = {}
);

Vec2 project_weak_perspective(const Camera& camera, const Vec3& world_point);

}  // namespace animocap
