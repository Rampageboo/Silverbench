#pragma once

#include <filesystem>
#include <span>
#include <string>

namespace animocap {

std::string sha256_bytes(std::span<const unsigned char> bytes);
std::string sha256_file(const std::filesystem::path& path);
std::string sha256_directory(const std::filesystem::path& path);

}  // namespace animocap
