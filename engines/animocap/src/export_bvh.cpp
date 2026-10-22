#include "animocap/export.hpp"

#include "animocap/math.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <locale>
#include <sstream>
#include <string>
#include <vector>

namespace animocap {
namespace {

constexpr double kPi = 3.141592653589793238462643383279502884;

struct EulerZxy {
    double z{};
    double x{};
    double y{};
};

std::string bvh_name(BoneSemantic semantic) {
    std::string result(to_string(semantic));
    if (!result.empty() && result.front() >= 'a' && result.front() <= 'z') {
        result.front() = static_cast<char>(result.front() - 'a' + 'A');
    }
    return result;
}

EulerZxy to_euler_zxy_degrees(const Quat& value) {
    const auto q = normalize(value);
    const double r00 = 1.0 - 2.0 * (q.y * q.y + q.z * q.z);
    const double r01 = 2.0 * (q.x * q.y - q.z * q.w);
    const double r10 = 2.0 * (q.x * q.y + q.z * q.w);
    const double r11 = 1.0 - 2.0 * (q.x * q.x + q.z * q.z);
    const double r20 = 2.0 * (q.x * q.z - q.y * q.w);
    const double r21 = 2.0 * (q.y * q.z + q.x * q.w);
    const double r22 = 1.0 - 2.0 * (q.x * q.x + q.y * q.y);

    const double x = std::asin(std::clamp(r21, -1.0, 1.0));
    const double cosine_x = std::cos(x);
    double y{};
    double z{};
    if (std::abs(cosine_x) > 1e-8) {
        y = std::atan2(-r20, r22);
        z = std::atan2(-r01, r11);
    } else {
        z = std::atan2(r10, r00);
    }
    constexpr double kDegrees = 180.0 / kPi;
    return {z * kDegrees, x * kDegrees, y * kDegrees};
}

double unwrap_degrees(double value, double previous) {
    while (value - previous > 180.0) value -= 360.0;
    while (value - previous < -180.0) value += 360.0;
    return value;
}

Vec3 scaled(const Vec3& value, double factor) {
    return {factor * value.x, factor * value.y, factor * value.z};
}

void write_offset(std::ostream& output, const Vec3& offset, int depth) {
    output << std::string(static_cast<std::size_t>(depth * 2), ' ')
           << "OFFSET " << offset.x << ' ' << offset.y << ' ' << offset.z << '\n';
}

void write_joint(
    std::ostream& output,
    const Skeleton& skeleton,
    const std::vector<std::vector<std::size_t>>& children,
    std::size_t index,
    int depth,
    double unit_scale,
    bool root,
    std::vector<std::size_t>& channel_order
) {
    const auto indent = std::string(static_cast<std::size_t>(depth * 2), ' ');
    output << indent << (root ? "ROOT " : "JOINT ")
           << bvh_name(skeleton.bones[index].semantic) << '\n';
    output << indent << "{\n";
    write_offset(output, root ? Vec3{} : scaled(skeleton.bones[index].rest_offset_m, unit_scale), depth + 1);
    output << std::string(static_cast<std::size_t>((depth + 1) * 2), ' ');
    if (root) {
        output << "CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation\n";
    } else {
        output << "CHANNELS 3 Zrotation Xrotation Yrotation\n";
    }
    channel_order.push_back(index);

    for (const auto child : children[index]) {
        write_joint(output, skeleton, children, child, depth + 1, unit_scale, false, channel_order);
    }
    if (children[index].empty()) {
        Vec3 end_offset = scaled(skeleton.bones[index].rest_offset_m, 0.25 * unit_scale);
        const double length = std::sqrt(
            end_offset.x * end_offset.x + end_offset.y * end_offset.y + end_offset.z * end_offset.z);
        if (length < 1e-8) end_offset = {0.0, 0.05 * unit_scale, 0.0};
        output << std::string(static_cast<std::size_t>((depth + 1) * 2), ' ') << "End Site\n";
        output << std::string(static_cast<std::size_t>((depth + 1) * 2), ' ') << "{\n";
        write_offset(output, end_offset, depth + 2);
        output << std::string(static_cast<std::size_t>((depth + 1) * 2), ' ') << "}\n";
    }
    output << indent << "}\n";
}

}  // namespace

void export_bvh(
    const MotionPackage& package,
    const std::filesystem::path& output_path,
    const BvhExportOptions& options
) {
    validate_motion(package.motion, package.skeleton);
    if (output_path.empty()) throw ContractError("BVH output path must not be empty");
    auto extension = output_path.extension().string();
    std::transform(extension.begin(), extension.end(), extension.begin(), [](unsigned char value) {
        return static_cast<char>(std::tolower(value));
    });
    if (extension != ".bvh") throw ContractError("BVH output path must use the .bvh extension");
    if (std::filesystem::exists(output_path) && !options.overwrite) {
        throw std::runtime_error("refusing to overwrite existing BVH file: " + output_path.string());
    }

    const auto scene_root = bone_index(package.skeleton, BoneSemantic::SceneRoot);
    const auto hips = bone_index(package.skeleton, BoneSemantic::Hips);
    if (package.skeleton.bones[hips].parent != static_cast<int>(scene_root)) {
        throw ContractError("BVH export requires hips to be a direct child of sceneRoot");
    }
    std::vector<std::vector<std::size_t>> children(package.skeleton.bones.size());
    for (std::size_t index = 0; index < package.skeleton.bones.size(); ++index) {
        const int parent = package.skeleton.bones[index].parent;
        if (parent >= 0 && index != hips) {
            children[static_cast<std::size_t>(parent)].push_back(index);
        }
    }

    const double unit_scale = options.unit == BvhUnit::Centimeters ? 100.0 : 1.0;
    std::ostringstream document;
    document.imbue(std::locale::classic());
    document << std::fixed << std::setprecision(6);
    document << "HIERARCHY\n";
    std::vector<std::size_t> channel_order;
    write_joint(document, package.skeleton, children, hips, 0, unit_scale, true, channel_order);
    document << "MOTION\nFrames: " << package.motion.frame_count
             << "\nFrame Time: " << (1.0 / package.motion.fps) << '\n';

    std::vector<EulerZxy> previous(package.skeleton.bones.size());
    std::vector<bool> has_previous(package.skeleton.bones.size(), false);
    const auto& motion = package.motion;
    for (std::size_t frame = 0; frame < motion.frame_count; ++frame) {
        const auto local = [&](std::size_t joint) -> const Quat& {
            return motion.local_rotations[frame * motion.joint_count + joint];
        };
        const auto scene_rotation = normalize(multiply(motion.scene_root_rotation[frame], local(scene_root)));
        const auto hips_rotation = normalize(multiply(scene_rotation, local(hips)));
        const Vec3 hips_local = package.skeleton.bones[hips].rest_offset_m + motion.hips_translation_m[frame];
        const Vec3 root_position = motion.scene_root_translation_m[frame] +
            package.skeleton.bones[scene_root].rest_offset_m + rotate(scene_rotation, hips_local);
        const auto position = scaled(root_position, unit_scale);
        document << position.x << ' ' << position.y << ' ' << position.z;

        for (const auto joint : channel_order) {
            EulerZxy angles = to_euler_zxy_degrees(joint == hips ? hips_rotation : local(joint));
            if (has_previous[joint]) {
                angles.z = unwrap_degrees(angles.z, previous[joint].z);
                angles.x = unwrap_degrees(angles.x, previous[joint].x);
                angles.y = unwrap_degrees(angles.y, previous[joint].y);
            }
            previous[joint] = angles;
            has_previous[joint] = true;
            document << ' ' << angles.z << ' ' << angles.x << ' ' << angles.y;
        }
        document << '\n';
    }

    if (!output_path.parent_path().empty()) {
        std::filesystem::create_directories(output_path.parent_path());
    }
    std::ofstream output(output_path, std::ios::binary | std::ios::trunc);
    if (!output) throw std::runtime_error("cannot write BVH file: " + output_path.string());
    const auto text = document.str();
    output.write(text.data(), static_cast<std::streamsize>(text.size()));
    if (!output) throw std::runtime_error("failed while writing BVH file: " + output_path.string());
}

}  // namespace animocap
