// Bounded stdin WAV -> stdout PCM16 WAV helper, isolated from the desktop host.
#define DR_WAV_IMPLEMENTATION
#define DR_WAV_NO_STDIO
#include "dr_wav/dr_wav.h"
#include <cstdio>
#include <vector>
#include <cstdint>
#include <io.h>
#include <fcntl.h>

static void le16(unsigned char* p, uint16_t n) { p[0] = n; p[1] = n >> 8; }
static void le32(unsigned char* p, uint32_t n) { for (int i = 0; i < 4; ++i) p[i] = n >> (i * 8); }
int main() {
    _setmode(_fileno(stdin), _O_BINARY); _setmode(_fileno(stdout), _O_BINARY);
    std::vector<unsigned char> input; unsigned char chunk[16384];
    while (size_t n = fread(chunk, 1, sizeof(chunk), stdin)) {
        if (input.size() + n > 32u * 1024 * 1024) return 2;
        input.insert(input.end(), chunk, chunk + n);
    }
    drwav wav;
    if (!drwav_init_memory(&wav, input.data(), input.size(), nullptr)) return 3;
    const uint64_t bytes = wav.totalPCMFrameCount * wav.channels * 2;
    if (!wav.channels || wav.channels > 2 || !wav.sampleRate || wav.sampleRate > 192000 ||
        wav.totalPCMFrameCount > uint64_t(wav.sampleRate) * 300 || bytes > 64u * 1024 * 1024) { drwav_uninit(&wav); return 4; }
    unsigned char header[44] = {};
    memcpy(header, "RIFF", 4); le32(header + 4, uint32_t(bytes) + 36); memcpy(header + 8, "WAVEfmt ", 8);
    le32(header + 16, 16); le16(header + 20, 1); le16(header + 22, uint16_t(wav.channels));
    le32(header + 24, wav.sampleRate); le32(header + 28, wav.sampleRate * wav.channels * 2);
    le16(header + 32, uint16_t(wav.channels * 2)); le16(header + 34, 16);
    memcpy(header + 36, "data", 4); le32(header + 40, uint32_t(bytes));
    if (fwrite(header, 1, sizeof(header), stdout) != sizeof(header)) { drwav_uninit(&wav); return 5; }
    drwav_int16 pcm[8192]; uint64_t done = 0;
    while (done < wav.totalPCMFrameCount) {
        const uint64_t count = (wav.totalPCMFrameCount - done < 4096) ? wav.totalPCMFrameCount - done : 4096;
        const uint64_t got = drwav_read_pcm_frames_s16(&wav, count, pcm);
        if (!got || fwrite(pcm, wav.channels * 2, size_t(got), stdout) != got) { drwav_uninit(&wav); return 5; }
        done += got;
    }
    drwav_uninit(&wav); return fflush(stdout) == 0 ? 0 : 5;
}
