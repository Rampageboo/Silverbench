#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace animocap {

enum class NpyDType { Float64, Float32, UInt8 };

struct NpyArray {
    NpyDType dtype{};
    std::vector<std::size_t> shape;
    std::vector<std::uint8_t> bytes;
};

std::string_view npy_descriptor(NpyDType dtype);
std::size_t npy_item_size(NpyDType dtype);
void write_npy(const std::filesystem::path& path, const NpyArray& array);
NpyArray read_npy(const std::filesystem::path& path);

template <typename T>
NpyArray make_npy(NpyDType dtype, std::vector<std::size_t> shape, const std::vector<T>& values) {
    NpyArray result{dtype, std::move(shape), {}};
    const auto* begin = reinterpret_cast<const std::uint8_t*>(values.data());
    result.bytes.assign(begin, begin + values.size() * sizeof(T));
    return result;
}

template <typename T>
std::vector<T> npy_values(const NpyArray& array, NpyDType expected) {
    if (array.dtype != expected || array.bytes.size() % sizeof(T) != 0) {
        throw std::runtime_error("NPY dtype or byte-size mismatch");
    }
    std::vector<T> result(array.bytes.size() / sizeof(T));
    std::memcpy(result.data(), array.bytes.data(), array.bytes.size());
    return result;
}

}  // namespace animocap
