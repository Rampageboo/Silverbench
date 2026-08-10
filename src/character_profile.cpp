#include "animocap/character_profile.hpp"

#include "animocap/contracts.hpp"

#include <nlohmann/json.hpp>

#include <cmath>
#include <fstream>
#include <string>
#include <string_view>

namespace animocap {
namespace {

using json = nlohmann::json;
constexpr std::string_view kCharacterProfileSchemaVersion = "1.1.0";

json read_json(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error(
        "cannot read character profile: " + path.string());
    json value;
    input >> value;
    if (!value.is_object()) throw ContractError(
        "character profile must be a JSON object");
    return value;
}

std::filesystem::path normalized_absolute(const std::filesystem::path& path) {
    return std::filesystem::absolute(path).lexically_normal();
}

}  // namespace

CharacterProfile load_character_profile(const std::filesystem::path& path) {
    CharacterProfile result;
    result.source_path = normalized_absolute(path);
    const auto value = read_json(result.source_path);

    if (!value.contains("canonical_skeleton")) {
        result.skeleton_path = result.source_path;
        result.skeleton = load_skeleton_json(result.skeleton_path);
        result.profile_id = result.skeleton.skeleton_id;
        return result;
    }

    result.schema_version = value.at("schema_version").get<std::string>();
    if (result.schema_version != kSchemaVersion &&
        result.schema_version != kCharacterProfileSchemaVersion) {
        throw ContractError("unsupported character profile schema_version");
    }
    const auto profile_id = value.at("profile_id").get<std::string>();
    const auto skeleton_value = value.at("canonical_skeleton").get<std::string>();
    if (profile_id.empty() || skeleton_value.empty()) {
        throw ContractError("character profile identifiers must not be empty");
    }
    result.profile_id = profile_id;
    if (result.schema_version == kCharacterProfileSchemaVersion) {
        result.role = value.at("role").get<std::string>();
        if (result.role != "source_character_reference") {
            throw ContractError(
                "character profile role must be source_character_reference");
        }
        const auto policy = value.at("proportion_policy").get<std::string>();
        if (policy == "similar_reference") {
            result.proportion_policy = ProportionPolicy::SimilarReference;
        } else if (policy == "exact_reference") {
            result.proportion_policy = ProportionPolicy::ExactReference;
        } else {
            throw ContractError("unsupported character profile proportion_policy");
        }
    }
    auto skeleton_path = std::filesystem::path(skeleton_value);
    if (skeleton_path.is_relative()) {
        skeleton_path = result.source_path.parent_path() / skeleton_path;
    }
    result.skeleton_path = normalized_absolute(skeleton_path);
    if (!std::filesystem::is_regular_file(result.skeleton_path)) {
        throw ContractError(
            "character profile canonical_skeleton is missing: " +
            result.skeleton_path.string());
    }

    const auto& policy = value.at("constraint_policy");
    if (policy.at("mode") != "low_confidence_bone_length" ||
        !policy.at("preserve_high_confidence_observations").get<bool>()) {
        throw ContractError(
            "character profile requires the low-confidence bone-length policy");
    }
    const double threshold = policy.at("low_confidence_threshold").get<double>();
    if (!std::isfinite(threshold) || threshold <= 0.0 || threshold > 1.0) {
        throw ContractError(
            "character profile low_confidence_threshold must be in (0, 1]");
    }
    result.optimization_options.low_confidence_threshold = threshold;
    result.skeleton = load_skeleton_json(result.skeleton_path);
    if (result.skeleton.skeleton_id != profile_id) {
        throw ContractError(
            "character profile_id must match canonical skeleton_id");
    }
    return result;
}

}  // namespace animocap
