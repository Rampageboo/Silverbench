#include "animocap/hash.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace animocap {
namespace {

constexpr std::array<std::uint32_t, 64> kRoundConstants{{
    0x428a2f98U,0x71374491U,0xb5c0fbcfU,0xe9b5dba5U,0x3956c25bU,0x59f111f1U,0x923f82a4U,0xab1c5ed5U,
    0xd807aa98U,0x12835b01U,0x243185beU,0x550c7dc3U,0x72be5d74U,0x80deb1feU,0x9bdc06a7U,0xc19bf174U,
    0xe49b69c1U,0xefbe4786U,0x0fc19dc6U,0x240ca1ccU,0x2de92c6fU,0x4a7484aaU,0x5cb0a9dcU,0x76f988daU,
    0x983e5152U,0xa831c66dU,0xb00327c8U,0xbf597fc7U,0xc6e00bf3U,0xd5a79147U,0x06ca6351U,0x14292967U,
    0x27b70a85U,0x2e1b2138U,0x4d2c6dfcU,0x53380d13U,0x650a7354U,0x766a0abbU,0x81c2c92eU,0x92722c85U,
    0xa2bfe8a1U,0xa81a664bU,0xc24b8b70U,0xc76c51a3U,0xd192e819U,0xd6990624U,0xf40e3585U,0x106aa070U,
    0x19a4c116U,0x1e376c08U,0x2748774cU,0x34b0bcb5U,0x391c0cb3U,0x4ed8aa4aU,0x5b9cca4fU,0x682e6ff3U,
    0x748f82eeU,0x78a5636fU,0x84c87814U,0x8cc70208U,0x90befffaU,0xa4506cebU,0xbef9a3f7U,0xc67178f2U,
}};

std::uint32_t rotate_right(std::uint32_t value, unsigned amount) {
    return (value >> amount) | (value << (32U - amount));
}

std::vector<unsigned char> read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("cannot hash file: " + path.string());
    input.seekg(0, std::ios::end);
    const auto size = input.tellg();
    if (size < 0) throw std::runtime_error("cannot determine file size: " + path.string());
    input.seekg(0, std::ios::beg);
    std::vector<unsigned char> bytes(static_cast<std::size_t>(size));
    input.read(reinterpret_cast<char*>(bytes.data()), size);
    if (!input && !bytes.empty()) throw std::runtime_error("cannot read file for hashing: " + path.string());
    return bytes;
}

}  // namespace

std::string sha256_bytes(std::span<const unsigned char> input) {
    std::vector<unsigned char> message(input.begin(), input.end());
    const auto bit_length = static_cast<std::uint64_t>(message.size()) * 8U;
    message.push_back(0x80U);
    while ((message.size() % 64U) != 56U) message.push_back(0U);
    for (int shift = 56; shift >= 0; shift -= 8) {
        message.push_back(static_cast<unsigned char>((bit_length >> shift) & 0xffU));
    }

    std::array<std::uint32_t, 8> state{{
        0x6a09e667U,0xbb67ae85U,0x3c6ef372U,0xa54ff53aU,
        0x510e527fU,0x9b05688cU,0x1f83d9abU,0x5be0cd19U,
    }};
    for (std::size_t offset = 0; offset < message.size(); offset += 64U) {
        std::array<std::uint32_t, 64> words{};
        for (std::size_t index = 0; index < 16; ++index) {
            const auto base = offset + index * 4U;
            words[index] = (static_cast<std::uint32_t>(message[base]) << 24U) |
                           (static_cast<std::uint32_t>(message[base + 1]) << 16U) |
                           (static_cast<std::uint32_t>(message[base + 2]) << 8U) |
                           static_cast<std::uint32_t>(message[base + 3]);
        }
        for (std::size_t index = 16; index < 64; ++index) {
            const auto s0 = rotate_right(words[index - 15], 7) ^ rotate_right(words[index - 15], 18) ^
                            (words[index - 15] >> 3U);
            const auto s1 = rotate_right(words[index - 2], 17) ^ rotate_right(words[index - 2], 19) ^
                            (words[index - 2] >> 10U);
            words[index] = words[index - 16] + s0 + words[index - 7] + s1;
        }
        auto a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7];
        for (std::size_t index = 0; index < 64; ++index) {
            const auto sum1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^ rotate_right(e, 25);
            const auto choose = (e & f) ^ ((~e) & g);
            const auto temp1 = h + sum1 + choose + kRoundConstants[index] + words[index];
            const auto sum0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^ rotate_right(a, 22);
            const auto majority = (a & b) ^ (a & c) ^ (b & c);
            const auto temp2 = sum0 + majority;
            h=g; g=f; f=e; e=d+temp1; d=c; c=b; b=a; a=temp1+temp2;
        }
        state[0]+=a; state[1]+=b; state[2]+=c; state[3]+=d;
        state[4]+=e; state[5]+=f; state[6]+=g; state[7]+=h;
    }

    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (const auto value : state) output << std::setw(8) << value;
    return output.str();
}

std::string sha256_file(const std::filesystem::path& path) {
    const auto bytes = read_file(path);
    return sha256_bytes(bytes);
}

std::string sha256_directory(const std::filesystem::path& path) {
    std::vector<std::filesystem::path> files;
    for (const auto& entry : std::filesystem::recursive_directory_iterator(path)) {
        if (entry.is_regular_file() && entry.path().filename() != "fixture.sha256") files.push_back(entry.path());
    }
    std::sort(files.begin(), files.end(), [&](const auto& lhs, const auto& rhs) {
        return std::filesystem::relative(lhs, path).generic_string() <
               std::filesystem::relative(rhs, path).generic_string();
    });

    std::vector<unsigned char> combined;
    for (const auto& file : files) {
        const auto relative = std::filesystem::relative(file, path).generic_string();
        combined.insert(combined.end(), relative.begin(), relative.end());
        combined.push_back(0);
        const auto bytes = read_file(file);
        combined.insert(combined.end(), bytes.begin(), bytes.end());
    }
    return sha256_bytes(combined);
}

}  // namespace animocap
