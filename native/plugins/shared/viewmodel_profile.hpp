// GPL-3.0, regoists/Skeeto 2.2.19, revision 7a18b4988d089fdf6cc7e857560cf82a9609a32c.
// Extracted pure viewmodel transform and v2 profile format. Engine and IO stay with callers.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cstdlib>
#include <cstdio>
namespace skviewmodel {
struct Vec { float x, y, z; };
struct Mat { float m[3][3]; };
static Mat AngleMatrix(Vec a) {
    const float radians = 0.01745329251994329577f;
    const float sp = std::sin(a.x * radians), cp = std::cos(a.x * radians);
    const float sy = std::sin(a.y * radians), cy = std::cos(a.y * radians);
    const float sr = std::sin(a.z * radians), cr = std::cos(a.z * radians);
    return { { { cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy },
               { cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy },
               { -sp, sr * cp, cr * cp } } };
}
static Vec MatrixAngles(const Mat& m) {
    const float degrees = 57.295779513082320876f;
    const float flat = std::sqrt(m.m[0][0] * m.m[0][0] + m.m[1][0] * m.m[1][0]);
    Vec a{ std::atan2(-m.m[2][0], flat) * degrees, 0, 0 };
    if (flat > 0.000001f) {
        a.y = std::atan2(m.m[1][0], m.m[0][0]) * degrees;
        a.z = std::atan2(m.m[2][1], m.m[2][2]) * degrees;
    } else a.y = std::atan2(-m.m[0][1], m.m[1][1]) * degrees;
    return a;
}
static Mat Product(const Mat& a, const Mat& b) {
    Mat r{};
    for (int i = 0; i < 3; ++i) for (int j = 0; j < 3; ++j)
        for (int k = 0; k < 3; ++k) r.m[i][j] += a.m[i][k] * b.m[k][j];
    return r;
}
static Vec Transform(const Mat& a, Vec v) {
    return { a.m[0][0]*v.x + a.m[0][1]*v.y + a.m[0][2]*v.z,
             a.m[1][0]*v.x + a.m[1][1]*v.y + a.m[1][2]*v.z,
             a.m[2][0]*v.x + a.m[2][1]*v.y + a.m[2][2]*v.z };
}
struct Pose {
    Vec position, rotation, pivot;
    float scale = 1.f; // whole first-person viewmodel; 1.0 keeps stock size
    Mat delta;
    bool rotated, active, mirror;
    void Rebuild() {
        rotated = rotation.x != 0 || rotation.y != 0 || rotation.z != 0;
        active = rotated || position.x != 0 || position.y != 0 || position.z != 0;
        delta = rotated ? AngleMatrix(rotation) : Mat{ { {1,0,0}, {0,1,0}, {0,0,1} } };
        if (!std::isfinite(scale)) scale = 1.f;
        else if (scale < .1f) scale = .1f;
        else if (scale > 5.f) scale = 5.f;
    }
};
// Wide enough to judge size by eye; extreme values can clip near the camera.
static float ClampScale(float value) {
    if (!std::isfinite(value)) return 1.f;
    if (value < .1f) return .1f;
    if (value > 5.f) return 5.f;
    return value;
}
static void Apply(const Pose& p, Vec eyeAngles, Vec origin, Vec nativeAngles,
                  Vec* outOrigin, Vec* outAngles) {
    *outOrigin = origin; *outAngles = nativeAngles;
    if (!p.active) return;
    const Mat camera = AngleMatrix(eyeAngles);
    const Vec offset = Transform(camera, { p.position.y, -p.position.x, p.position.z });
    outOrigin->x += offset.x; outOrigin->y += offset.y; outOrigin->z += offset.z;
    if (!p.rotated) return;
    Mat transposed{};
    for (int i = 0; i < 3; ++i) for (int j = 0; j < 3; ++j) transposed.m[i][j] = camera.m[j][i];
    const Mat worldDelta = Product(Product(camera, p.delta), transposed);
    const Mat native = AngleMatrix(nativeAngles);
    *outAngles = MatrixAngles(Product(worldDelta, native));
    if (p.pivot.x != 0 || p.pivot.y != 0 || p.pivot.z != 0) {
        const Vec point = Transform(native, { p.pivot.y, -p.pivot.x, p.pivot.z });
        const Vec rotatedPoint = Transform(worldDelta, point);
        outOrigin->x += point.x - rotatedPoint.x;
        outOrigin->y += point.y - rotatedPoint.y;
        outOrigin->z += point.z - rotatedPoint.z;
    }
}
// Normalize only on binding/edit/load, never while rendering each pose.
static bool NormalizeModel(const char* source, char* out, size_t cap = 260) {
    char normalized[260]; size_t n = 0;
    while (source[n]) {
        if (n == 259) return false;
        unsigned char c = static_cast<unsigned char>(source[n]);
        if (c < 32 || c == 127 || c == '[' || c == ']' || c == '|' || c == ':') return false;
        if (c == '\\') c = '/';
        if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
        normalized[n++] = static_cast<char>(c);
    }
    normalized[n] = 0;
    if (n < 12 || cap <= n || std::memcmp(normalized, "models/", 7) ||
        std::memcmp(normalized + n - 4, ".mdl", 4)) return false;
    // Empty/dot segments and traversal have no meaningful model identity.
    size_t segment = 0;
    for (size_t i = 0; i <= n; ++i) if (normalized[i] == '/' || i == n) {
        const size_t length = i - segment;
        if (!length || (length == 1 && normalized[segment] == '.') ||
            (length == 2 && normalized[segment] == '.' && normalized[segment + 1] == '.')) return false;
        segment = i + 1;
    }
    std::memcpy(out, normalized, n + 1); return true;
}
// Necola assigns _nclN when enumerating same-weapon variants. That number can
// change after a VPK rename; retain the weapon resource path and MDL checksum.
// Inputs are already normalized/validated; this runs only on binding/edit/load.
static void ProfileModelPath(const char* model, char* out) {
    size_t length = std::strlen(model);
    std::memcpy(out, model, length + 1);
    const size_t filename = size_t(std::strrchr(out, '/') - out) + 1;
    for (;;) {
        size_t digits = length - 4;
        while (digits > filename && out[digits - 1] >= '0' && out[digits - 1] <= '9') --digits;
        if (digits == length - 4 || out[digits] == '0' || digits <= filename + 4
            || std::memcmp(out + digits - 4, "_ncl", 4)) break;
        std::memcpy(out + digits - 4, ".mdl", 5);
        length = digits;
    }
}
static bool SameProfileModel(const char* a, const char* b) {
    if (!std::strcmp(a, b)) return true;
    if (!a[0] || !b[0]) return false;
    char left[260], right[260];
    ProfileModelPath(a, left); ProfileModelPath(b, right);
    return !std::strcmp(left, right);
}
struct Record { char model[260]; uint32_t checksum; Pose pose; };
struct Store {
    int count;
    Record records[256];
    // Callers supply a validated normalized path; no repeated normalization.
    int FindExact(const char* model, uint32_t checksum) const {
        for (int i = 0; i < count; ++i)
            if (records[i].checksum == checksum && !std::strcmp(records[i].model, model)) return i;
        return -1;
    }
    int Find(const char* model, uint32_t checksum) const {
        char key[260]; ProfileModelPath(model, key);
        return FindExact(key, checksum);
    }
    int Append(const char* model, uint32_t checksum) {
        if (count == 256) return -1;
        Record& r = records[count]; r = {};
        std::strcpy(r.model, model); r.checksum = checksum;
        r.pose.scale = 1.f; r.pose.Rebuild();
        return count++;
    }
    int Ensure(const char* model, uint32_t checksum) {
        char key[260]; ProfileModelPath(model, key);
        const int existing = FindExact(key, checksum); if (existing >= 0) return existing;
        return Append(key, checksum);
    }
};
static bool Space(char c) { return c == ' ' || c == '\t'; }
static bool ParseVector(const char* source, float limit, Vec* out) {
    float values[3];
    for (int i = 0; i < 3; ++i) {
        while (Space(*source)) ++source;
        char* end = nullptr; values[i] = std::strtof(source, &end);
        if (end == source || !std::isfinite(values[i]) || values[i] < -limit || values[i] > limit) return false;
        if (i != 2 && !Space(*end)) return false;
        source = end;
    }
    while (Space(*source)) ++source;
    if (*source) return false;
    *out = { values[0], values[1], values[2] }; return true;
}
// Transactional bounded parser: failures leave the caller's store intact.
static bool Parse(const char* text, size_t length, Store* out) {
    if (length > 256 * 1024) return false;
    Store candidate{}; int current = -1, fields = 0; bool header = false;
    size_t offset = 0;
    while (offset < length) {
        char line[512]; size_t n = 0;
        while (offset < length && text[offset] != '\n') {
            const char c = text[offset++];
            if (!c || n == sizeof(line) - 1) return false;
            line[n++] = c;
        }
        if (offset < length) ++offset;
        if (n && line[n - 1] == '\r') --n;
        while (n && Space(line[n - 1])) --n;
        line[n] = 0; char* start = line; while (Space(*start)) ++start;
        if (!*start) continue;
        if (*start == '#') {
            if (!std::strcmp(start, "# Skeeto viewmodel profiles v2")) {
                if (header || current >= 0) return false;
                header = true;
            }
            continue;
        }
        if (!header) return false;
        if (*start == '[') {
            // position|rotation|pivot|mirror required (15); scale optional (16).
            if (current >= 0 && (fields & 15) != 15) return false;
            if (current >= 0 && !(fields & 16)) candidate.records[current].pose.scale = 1.f;
            const size_t size = std::strlen(start);
            if (size < 12 || start[size - 1] != ']') return false;
            start[size - 1] = 0; char* separator = std::strchr(start + 1, '|');
            if (!separator || std::strlen(separator + 1) != 8) return false;
            uint32_t checksum = 0;
            for (int i = 1; i <= 8; ++i) {
                const char c = separator[i]; unsigned value;
                if (c >= '0' && c <= '9') value = c - '0';
                else if (c >= 'a' && c <= 'f') value = c - 'a' + 10;
                else if (c >= 'A' && c <= 'F') value = c - 'A' + 10;
                else return false;
                checksum = (checksum << 4) | value;
            }
            *separator = 0; char normalized[260], model[260];
            if (!NormalizeModel(start + 1, normalized)) return false;
            ProfileModelPath(normalized, model);
            // 2.2.4 keyed records by Necola's generated _nclN name. Same-MDL entries from
            // different numbers now share one key; one old record must not reject the file
            // (that also leaves it read-only). File order is write order, so the later wins.
            current = candidate.FindExact(model, checksum);
            if (current >= 0) { candidate.records[current].pose = {}; candidate.records[current].pose.scale = 1.f; }
            else if ((current = candidate.Append(model, checksum)) < 0) return false;
            fields = 0;
        } else {
            if (current < 0) return false;
            char* separator = std::strchr(start, '='); if (!separator) return false;
            char* end = separator; while (end > start && Space(end[-1])) --end; *end = 0;
            Vec* vector; float limit; int bit;
            Pose& pose = candidate.records[current].pose;
            if (!std::strcmp(start, "position")) { vector = &pose.position; limit = 100; bit = 1; }
            else if (!std::strcmp(start, "rotation")) { vector = &pose.rotation; limit = 180; bit = 2; }
            else if (!std::strcmp(start, "pivot")) { vector = &pose.pivot; limit = 100; bit = 4; }
            else if (!std::strcmp(start, "mirror")) {
                if (fields & 8) return false;
                char* value = separator + 1;
                while (Space(*value)) ++value;
                if ((*value != '0' && *value != '1') || (value[1] && !Space(value[1]))) return false;
                char* tail = value + 1; while (Space(*tail)) ++tail;
                if (*tail) return false;
                pose.mirror = *value == '1'; fields |= 8; continue;
            } else if (!std::strcmp(start, "scale")) {
                if (fields & 16) return false;
                char* value = separator + 1;
                while (Space(*value)) ++value;
                char* parsed = nullptr; const float raw = std::strtof(value, &parsed);
                if (parsed == value || !std::isfinite(raw)) return false;
                char* tail = parsed; while (Space(*tail)) ++tail;
                if (*tail) return false;
                pose.scale = ClampScale(raw); fields |= 16; continue;
            } else return false;
            if ((fields & bit) || !ParseVector(separator + 1, limit, vector)) return false;
            fields |= bit;
        }
    }
    if (!header || (current >= 0 && (fields & 15) != 15)) return false;
    if (current >= 0 && !(fields & 16)) candidate.records[current].pose.scale = 1.f;
    for (int i = 0; i < candidate.count; ++i) candidate.records[i].pose.Rebuild();
    *out = candidate; return true;
}
// Returns bytes excluding terminator. 0 indicates invalid input or insufficient
// output capacity, and out[0] is cleared so a caller cannot save partial output.
static size_t Format(const Store& store, char* out, size_t cap) {
    if (!cap) return 0;
    out[0] = 0;
    if (store.count < 0 || store.count > 256) return 0;
    const char* header = "# Skeeto viewmodel profiles v2\n";
    size_t used = std::strlen(header); if (cap <= used) return 0;
    std::memcpy(out, header, used + 1);
    for (int i = 0; i < store.count; ++i) {
        const Record& r = store.records[i]; const Pose& p = r.pose;
        char normalized[260];
        if (!NormalizeModel(r.model, normalized) || std::strcmp(r.model, normalized)) { out[0] = 0; return 0; }
        const float values[9] = { p.position.x,p.position.y,p.position.z,p.rotation.x,p.rotation.y,p.rotation.z,p.pivot.x,p.pivot.y,p.pivot.z };
        for (int j = 0; j < 9; ++j) {
            const float limit = j >= 3 && j < 6 ? 180.0f : 100.0f;
            if (!std::isfinite(values[j]) || values[j] < -limit || values[j] > limit) { out[0] = 0; return 0; }
        }
        const float scale = ClampScale(p.scale);
        if (!std::isfinite(scale)) { out[0] = 0; return 0; }
        const int written = std::snprintf(out + used, cap - used,
            "[%s|%08x]\nposition=%.9g %.9g %.9g\nrotation=%.9g %.9g %.9g\npivot=%.9g %.9g %.9g\nmirror=%d\nscale=%.9g\n",
            r.model, static_cast<unsigned>(r.checksum), p.position.x,p.position.y,p.position.z,
            p.rotation.x,p.rotation.y,p.rotation.z,p.pivot.x,p.pivot.y,p.pivot.z,p.mirror ? 1 : 0, scale);
        if (written < 0 || static_cast<size_t>(written) >= cap - used) { out[0] = 0; return 0; }
        used += static_cast<size_t>(written);
    }
    return used;
}
}

