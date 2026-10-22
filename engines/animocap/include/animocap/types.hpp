#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <string>

namespace animocap {

inline constexpr const char* kSchemaVersion = "1.0.0";

class ContractError final : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

struct Vec2 {
    double x{};
    double y{};
    bool operator==(const Vec2&) const = default;
};

struct Vec3 {
    double x{};
    double y{};
    double z{};

    Vec3& operator+=(const Vec3& other) {
        x += other.x; y += other.y; z += other.z;
        return *this;
    }
    bool operator==(const Vec3&) const = default;
};

inline Vec3 operator+(Vec3 lhs, const Vec3& rhs) { return lhs += rhs; }
inline Vec3 operator-(const Vec3& a, const Vec3& b) {
    return {a.x - b.x, a.y - b.y, a.z - b.z};
}
inline Vec3 operator*(double scale, const Vec3& value) {
    return {scale * value.x, scale * value.y, scale * value.z};
}

struct Quat {
    double w{1.0};
    double x{};
    double y{};
    double z{};
    bool operator==(const Quat&) const = default;
};

struct Camera {
    std::string id;
    double yaw_degrees{};
    double pitch_degrees{};
    double scale_pixels_per_meter{300.0};
    Vec2 principal_point{320.0, 360.0};
    bool operator==(const Camera&) const = default;
};

}  // namespace animocap
