#include "animocap/math.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace animocap {
namespace {
constexpr double kEpsilon = 1e-12;
constexpr double kPi = 3.141592653589793238462643383279502884;
double dot(const Quat& a, const Quat& b) {
    return a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
}
}

double quat_norm(const Quat& value) {
    return std::sqrt(dot(value, value));
}

Quat normalize(const Quat& value) {
    const double length = quat_norm(value);
    if (!std::isfinite(length) || length < kEpsilon) throw ContractError("quaternion must be finite and non-zero");
    return {value.w / length, value.x / length, value.y / length, value.z / length};
}

Quat conjugate(const Quat& value) {
    return {value.w, -value.x, -value.y, -value.z};
}

Quat multiply(const Quat& a, const Quat& b) {
    return {
        a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    };
}

Quat from_axis_angle(const Vec3& axis, double radians) {
    const double length = std::sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
    if (!std::isfinite(length) || length < kEpsilon || !std::isfinite(radians)) {
        throw ContractError("axis-angle must be finite with a non-zero axis");
    }
    const double half = radians * 0.5;
    const double scale = std::sin(half) / length;
    return normalize({std::cos(half), axis.x * scale, axis.y * scale, axis.z * scale});
}

Vec3 rotate(const Quat& rotation, const Vec3& point) {
    const auto q = normalize(rotation);
    const auto value = multiply(multiply(q, {0.0, point.x, point.y, point.z}), conjugate(q));
    return {value.x, value.y, value.z};
}

void enforce_quaternion_continuity(std::vector<Quat>& values) {
    for (auto& value : values) value = normalize(value);
    for (std::size_t index = 1; index < values.size(); ++index) {
        if (dot(values[index - 1], values[index]) < 0.0) {
            values[index].w = -values[index].w;
            values[index].x = -values[index].x;
            values[index].y = -values[index].y;
            values[index].z = -values[index].z;
        }
    }
}

Vec3 canonical_to_blender(const Vec3& value) {
    return {value.x, -value.z, value.y};
}

Vec3 blender_to_canonical(const Vec3& value) {
    return {value.x, value.z, -value.y};
}

Quat canonical_to_blender(const Quat& value) {
    const auto q = normalize(value);
    return normalize({q.w, q.x, -q.z, q.y});
}

Quat blender_to_canonical(const Quat& value) {
    const auto q = normalize(value);
    return normalize({q.w, q.x, q.z, -q.y});
}

FKResult forward_kinematics(
    const Skeleton& skeleton,
    const std::vector<Quat>& local_rotations,
    const Vec3& scene_root_translation_m,
    const Vec3& hips_translation_m
) {
    validate_skeleton(skeleton);
    if (local_rotations.size() != skeleton.bones.size()) {
        throw ContractError("FK local rotation count must match skeleton");
    }

    FKResult result;
    result.positions_m.resize(skeleton.bones.size());
    result.global_rotations.resize(skeleton.bones.size());
    for (std::size_t index = 0; index < skeleton.bones.size(); ++index) {
        const auto& bone = skeleton.bones[index];
        const auto local = normalize(local_rotations[index]);
        if (bone.parent < 0) {
            result.positions_m[index] = scene_root_translation_m + bone.rest_offset_m;
            result.global_rotations[index] = local;
            continue;
        }
        const auto parent = static_cast<std::size_t>(bone.parent);
        Vec3 offset = bone.rest_offset_m;
        if (bone.semantic == BoneSemantic::Hips) offset += hips_translation_m;
        result.positions_m[index] = result.positions_m[parent] + rotate(result.global_rotations[parent], offset);
        result.global_rotations[index] = normalize(multiply(result.global_rotations[parent], local));
    }
    return result;
}

Vec2 project_weak_perspective(const Camera& camera, const Vec3& point) {
    const double yaw = -camera.yaw_degrees * kPi / 180.0;
    const double pitch = -camera.pitch_degrees * kPi / 180.0;
    const double cy = std::cos(yaw);
    const double sy = std::sin(yaw);
    const Vec3 yawed{cy * point.x + sy * point.z, point.y, -sy * point.x + cy * point.z};
    const double cp = std::cos(pitch);
    const double sp = std::sin(pitch);
    const Vec3 camera_point{yawed.x, cp * yawed.y - sp * yawed.z, sp * yawed.y + cp * yawed.z};
    return {
        camera.principal_point.x + camera.scale_pixels_per_meter * camera_point.x,
        camera.principal_point.y - camera.scale_pixels_per_meter * camera_point.y,
    };
}

}  // namespace animocap
