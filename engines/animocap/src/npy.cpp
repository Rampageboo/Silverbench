#include "animocap/npy.hpp"

#include <algorithm>
#include <bit>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <limits>
#include <regex>
#include <sstream>
#include <stdexcept>

namespace animocap {
namespace {

std::size_t element_count(const std::vector<std::size_t>& shape) {
    if (shape.empty()) throw std::runtime_error("NPY shape must not be empty");
    std::size_t count = 1;
    for (const auto dimension : shape) {
        if (dimension == 0 || count > std::numeric_limits<std::size_t>::max() / dimension) {
            throw std::runtime_error("NPY shape is empty or overflows");
        }
        count *= dimension;
    }
    return count;
}

std::string shape_text(const std::vector<std::size_t>& shape) {
    std::ostringstream output;
    output << '(';
    for (std::size_t index = 0; index < shape.size(); ++index) {
        if (index != 0) output << ", ";
        output << shape[index];
    }
    if (shape.size() == 1) output << ',';
    output << ')';
    return output.str();
}

NpyDType dtype_from_descriptor(std::string_view descriptor) {
    if (descriptor == "<f8") return NpyDType::Float64;
    if (descriptor == "<f4") return NpyDType::Float32;
    if (descriptor == "|u1") return NpyDType::UInt8;
    throw std::runtime_error("unsupported NPY dtype descriptor: " + std::string(descriptor));
}

}  // namespace

std::string_view npy_descriptor(NpyDType dtype) {
    switch (dtype) {
        case NpyDType::Float64: return "<f8";
        case NpyDType::Float32: return "<f4";
        case NpyDType::UInt8: return "|u1";
    }
    throw std::runtime_error("invalid NPY dtype");
}

std::size_t npy_item_size(NpyDType dtype) {
    switch (dtype) {
        case NpyDType::Float64: return 8;
        case NpyDType::Float32: return 4;
        case NpyDType::UInt8: return 1;
    }
    throw std::runtime_error("invalid NPY dtype");
}

void write_npy(const std::filesystem::path& path, const NpyArray& array) {
    if constexpr (std::endian::native != std::endian::little) {
        throw std::runtime_error("NPY writer currently requires little-endian hardware");
    }
    const auto expected_bytes = element_count(array.shape) * npy_item_size(array.dtype);
    if (array.bytes.size() != expected_bytes) throw std::runtime_error("NPY payload does not match shape and dtype");

    std::string header = "{'descr': '" + std::string(npy_descriptor(array.dtype)) +
        "', 'fortran_order': False, 'shape': " + shape_text(array.shape) + ", }";
    constexpr std::size_t prefix_size = 10;
    const auto padding = (16 - ((prefix_size + header.size() + 1) % 16)) % 16;
    header.append(padding, ' ');
    header.push_back('\n');
    if (header.size() > std::numeric_limits<std::uint16_t>::max()) throw std::runtime_error("NPY header too large");

    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot write NPY file: " + path.string());
    const unsigned char magic[] = {0x93, 'N', 'U', 'M', 'P', 'Y', 1, 0};
    output.write(reinterpret_cast<const char*>(magic), sizeof(magic));
    const auto header_length = static_cast<std::uint16_t>(header.size());
    const unsigned char length_bytes[] = {
        static_cast<unsigned char>(header_length & 0xff),
        static_cast<unsigned char>((header_length >> 8) & 0xff),
    };
    output.write(reinterpret_cast<const char*>(length_bytes), sizeof(length_bytes));
    output.write(header.data(), static_cast<std::streamsize>(header.size()));
    output.write(reinterpret_cast<const char*>(array.bytes.data()), static_cast<std::streamsize>(array.bytes.size()));
    if (!output) throw std::runtime_error("failed while writing NPY file: " + path.string());
}

NpyArray read_npy(const std::filesystem::path& path) {
    if constexpr (std::endian::native != std::endian::little) {
        throw std::runtime_error("NPY reader currently requires little-endian hardware");
    }
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("cannot read NPY file: " + path.string());

    unsigned char prefix[10]{};
    input.read(reinterpret_cast<char*>(prefix), sizeof(prefix));
    const unsigned char expected_magic[] = {0x93, 'N', 'U', 'M', 'P', 'Y'};
    if (!input || !std::equal(std::begin(expected_magic), std::end(expected_magic), prefix) ||
        prefix[6] != 1 || prefix[7] != 0) {
        throw std::runtime_error("unsupported or invalid NPY header");
    }
    const auto header_length = static_cast<std::uint16_t>(prefix[8] | (prefix[9] << 8));
    std::string header(header_length, '\0');
    input.read(header.data(), static_cast<std::streamsize>(header.size()));
    if (!input || header.empty() || header.back() != '\n') throw std::runtime_error("truncated NPY header");

    std::smatch match;
    const std::regex descriptor_pattern(R"('descr': '([^']+)')");
    if (!std::regex_search(header, match, descriptor_pattern)) throw std::runtime_error("NPY descr missing");
    const auto dtype = dtype_from_descriptor(match[1].str());
    if (header.find("'fortran_order': False") == std::string::npos) {
        throw std::runtime_error("Fortran-order NPY arrays are unsupported");
    }
    const std::regex shape_pattern(R"('shape': \(([^)]*)\))");
    if (!std::regex_search(header, match, shape_pattern)) throw std::runtime_error("NPY shape missing");

    std::vector<std::size_t> shape;
    std::stringstream dimensions(match[1].str());
    std::string token;
    while (std::getline(dimensions, token, ',')) {
        const auto begin = token.find_first_not_of(' ');
        if (begin == std::string::npos) continue;
        const auto text = token.substr(begin);
        std::size_t consumed = 0;
        const auto dimension = std::stoull(text, &consumed);
        if (consumed != text.size()) throw std::runtime_error("invalid NPY dimension");
        shape.push_back(static_cast<std::size_t>(dimension));
    }

    const auto bytes_expected = element_count(shape) * npy_item_size(dtype);
    std::vector<std::uint8_t> bytes(bytes_expected);
    input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (input.gcount() != static_cast<std::streamsize>(bytes.size())) throw std::runtime_error("truncated NPY payload");
    if (input.peek() != std::char_traits<char>::eof()) throw std::runtime_error("unexpected bytes after NPY payload");
    return {dtype, std::move(shape), std::move(bytes)};
}

}  // namespace animocap
