// GPL-3.0. Skeeto 2.2.19 safe-house and last-man media workers.
// Extracted from skeeto_background.cpp; VFileSystem access uses Source File API.
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mmsystem.h>
#include <cstdio>
#include <cstring>
#include <atomic>
#include <vector>
#include <string>
#include "music.hpp"
#include "assets.inc"
namespace {
constexpr int kAudioBlockCount=16;
constexpr unsigned kAudioSampleMax=2u*1024u*1024u;
struct AudioBlock {WAVEHDR header{};std::vector<unsigned char> bytes;bool prepared=false;};
static bool OpenAudioReader(const wchar_t* source, IMFSourceReader** outReader,
	WAVEFORMATEX* outFormat) {
	if (!source || !outReader || !outFormat) return false;
	*outReader = nullptr;
	memset(outFormat, 0, sizeof(*outFormat));
	IMFAttributes* attrs = nullptr;
	IMFSourceReader* reader = nullptr;
	IMFMediaType* native = nullptr;
	IMFMediaType* output = nullptr;
	UINT32 channels = 0, sampleRate = 0;
	bool ok = false;
	if (FAILED(MFCreateAttributes(&attrs, 2))) goto done;
	attrs->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
	attrs->SetUINT32(MF_LOW_LATENCY, TRUE);
	if (FAILED(MFCreateSourceReaderFromURL(source, attrs, &reader)) || !reader) goto done;
	reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE);
	if (FAILED(reader->SetStreamSelection(MF_SOURCE_READER_FIRST_AUDIO_STREAM, TRUE))) goto done;
	if (FAILED(reader->GetNativeMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, &native))) goto done;
	native->GetUINT32(MF_MT_AUDIO_NUM_CHANNELS, &channels);
	native->GetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, &sampleRate);
	if (!channels || channels > 8 || sampleRate < 8000 || sampleRate > 192000) goto done;
	// Background packs are normally stereo AAC. Request bounded 16-bit PCM so
	// waveOut receives a fixed-size, mixer-friendly format. Downmix multichannel
	// sources to stereo instead of exposing an invalid legacy WAVEFORMATEX.
	if (channels > 2) channels = 2;
	if (FAILED(MFCreateMediaType(&output))) goto done;
	output->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
	output->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM);
	output->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, channels);
	output->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, sampleRate);
	output->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
	output->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, channels * 2u);
	output->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, sampleRate * channels * 2u);
	output->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);
	if (FAILED(reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, nullptr, output)))
		goto done;
	outFormat->wFormatTag = WAVE_FORMAT_PCM;
	outFormat->nChannels = (WORD)channels;
	outFormat->nSamplesPerSec = sampleRate;
	outFormat->wBitsPerSample = 16;
	outFormat->nBlockAlign = (WORD)(channels * 2u);
	outFormat->nAvgBytesPerSec = sampleRate * outFormat->nBlockAlign;
	outFormat->cbSize = 0;
	*outReader = reader;
	reader = nullptr;
	ok = true;
done:
	if (output) output->Release();
	if (native) native->Release();
	if (reader) reader->Release();
	if (attrs) attrs->Release();
	return ok;
}

static void ScalePcm16(std::vector<unsigned char>& bytes, int volume) {
	if (volume >= 100 || bytes.empty()) return;
	if (volume <= 0) {
		memset(bytes.data(), 0, bytes.size());
		return;
	}
	short* samples = (short*)bytes.data();
	const size_t count = bytes.size() / sizeof(short);
	for (size_t i = 0; i < count; ++i)
		samples[i] = (short)((int)samples[i] * volume / 100);
}

static void ReleaseAudioBlocks(HWAVEOUT output, AudioBlock* blocks) {
	if (!output || !blocks) return;
	waveOutReset(output);
	for (int i = 0; i < kAudioBlockCount; ++i) {
		if (blocks[i].prepared) {
			waveOutUnprepareHeader(output, &blocks[i].header, sizeof(WAVEHDR));
			blocks[i].prepared = false;
		}
		blocks[i].header = {};
		blocks[i].bytes.clear();
	}
}

}
namespace {
struct SafeMusicConfig {
	char directory[520]{};
	char selected[256]{};
	bool enabled = false, random = false;
};
static SRWLOCK g_safeLock = SRWLOCK_INIT;
static SafeMusicConfig g_safeConfig;
static SkeetoSafeMusicCatalog g_safeCatalog{};
static std::atomic_bool g_safeEnabled{false}, g_safeStop{false}, g_safeScan{false};
static std::atomic_int g_safeVolume{100}, g_safeWakeUsers{0}, g_safeMediaState{0};
static std::atomic_uint g_safeStartedCount{0}, g_lastStartedCount{0};
static std::atomic_uint g_safeGeneration{1}, g_safeReady{0}, g_safeRequest{0}, g_safeClaimed{0};
static std::atomic<HANDLE> g_safeWake{nullptr};
static HANDLE g_safeWorker = nullptr; // MainThread ownership only.

static void SafeMusicWake() {
	g_safeWakeUsers.fetch_add(1, std::memory_order_acq_rel);
	HANDLE wake = g_safeWake.load(std::memory_order_acquire);
	if (wake) SetEvent(wake);
	g_safeWakeUsers.fetch_sub(1, std::memory_order_release);
}

static SafeMusicConfig SafeMusicSnapshot() {
	AcquireSRWLockShared(&g_safeLock);
	SafeMusicConfig config = g_safeConfig;
	ReleaseSRWLockShared(&g_safeLock);
	return config;
}

static SRWLOCK g_safeResourceLock = SRWLOCK_INIT;
static std::atomic_bool g_safeCatalogReady{false};
static DlcGameGlobScan* g_safeGlob = nullptr;
static DlcCacheExtract* g_safeExtract = nullptr;
static SkeetoSafeMusicCatalog g_safeScanCatalog{};
static unsigned g_safeResourceGeneration = 0, g_safeExtractId = 0, g_safeExtractDoneId = 0;
static int g_safeScanPhase = -1;
// Source request/result fields use g_safeLock; workers receive only native paths.
static char g_safeSourceName[256]{};
static wchar_t g_safeSourcePath[520]{};
static unsigned g_safeSourceId = 0, g_safeSourceGeneration = 0, g_safeSourcePublishedId = 0;

static void SafeMusicCatalogAddName(const char* name, void* rawCatalog) {
	if (!name || !rawCatalog || !name[0] || strpbrk(name, "/\\:\r\n")) return;
	const size_t length = strlen(name);
	if (length >= 256 || length + sizeof("sound/skeeto/safe/") > 260) return;
	const char* extension = strrchr(name, '.');
	if (!extension || (_stricmp(extension, ".wav") && _stricmp(extension, ".mp3"))) return;
	wchar_t validated[256]{};
	if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, name, -1, validated, 256)) return;
	SkeetoSafeMusicCatalog* catalog = (SkeetoSafeMusicCatalog*)rawCatalog;
	for (int i = 0; i < catalog->count; ++i)
		if (!_stricmp(catalog->names[i], name)) return;
	if (catalog->count >= 128) { catalog->truncated = true; return; }
	strcpy_s(catalog->names[catalog->count++], name);
}

static void SafeMusicPublishCatalog() {
	qsort(g_safeScanCatalog.names, (size_t)g_safeScanCatalog.count, sizeof(g_safeScanCatalog.names[0]),
		[](const void* a, const void* b) -> int { return _stricmp((const char*)a, (const char*)b); });
	AcquireSRWLockExclusive(&g_safeLock);
	g_safeScanCatalog.revision = g_safeCatalog.revision + 1;
	if (!g_safeScanCatalog.revision) g_safeScanCatalog.revision = 1;
	g_safeCatalog = g_safeScanCatalog;
	ReleaseSRWLockExclusive(&g_safeLock);
	g_safeCatalogReady.store(true, std::memory_order_release);
	SafeMusicWake();
}

// The reader, output and all WAVEHDR storage belong solely to this worker.
// A ready token is published only after an output and first PCM block exist.
static DWORD WINAPI SafeMusicThread(void*) {
	const HRESULT com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
	const HRESULT mf = SUCCEEDED(com) ? MFStartup(MF_VERSION, MFSTARTUP_LITE) : E_FAIL;
	unsigned generation = 0;
	int previous = -1;
	unsigned seed = GetTickCount() ^ GetCurrentProcessId();
	IMFSourceReader* reader = nullptr;
	HWAVEOUT output = nullptr;
	WAVEFORMATEX format{};
	AudioBlock blocks[kAudioBlockCount]{};
	bool first = false, playing = false, eof = false, attempted = false, awaitingSource = false;
	unsigned sourceId = 0;
	while (!g_safeStop.load(std::memory_order_acquire)) {
		const unsigned current = g_safeGeneration.load(std::memory_order_acquire);
		if (generation != current) {
			g_safeReady.store(0, std::memory_order_release);
			if (output) { ReleaseAudioBlocks(output, blocks); waveOutClose(output); output = nullptr; }
			if (reader) { reader->Release(); reader = nullptr; }
			first = playing = eof = attempted = awaitingSource = false;
			generation = current;
		}
		if (!g_safeEnabled.load(std::memory_order_acquire) || FAILED(mf)) {
            if (g_safeEnabled.load() && FAILED(mf)) g_safeMediaState = -1;
			WaitForSingleObject(g_safeWake.load(), 100);
			continue;
		}
		if (!reader && !attempted && g_safeCatalogReady.load(std::memory_order_acquire)) {
			attempted = true;
			const SafeMusicConfig config = SafeMusicSnapshot();
			char name[256]{};
			AcquireSRWLockShared(&g_safeLock);
			const int count = g_safeCatalog.count;
			int chosen = -1;
			if (count && config.random) {
				seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
				chosen = (int)(seed % (unsigned)count);
				if (count > 1 && chosen == previous) chosen = (chosen + 1) % count;
			} else {
				for (int i = 0; i < count; ++i)
					if (!strcmp(config.selected, g_safeCatalog.names[i])) { chosen = i; break; }
				if (chosen < 0 && !config.selected[0] && count) chosen = 0;
			}
			if (chosen >= 0) strcpy_s(name, g_safeCatalog.names[chosen]);
			ReleaseSRWLockShared(&g_safeLock);
			if (name[0]) {
				AcquireSRWLockExclusive(&g_safeLock);
				strcpy_s(g_safeSourceName, name);
				g_safeSourceGeneration = generation;
				sourceId = ++g_safeSourceId;
				if (!sourceId) sourceId = ++g_safeSourceId;
				ReleaseSRWLockExclusive(&g_safeLock);
				awaitingSource = true;
				previous = chosen;
			} else g_safeMediaState = -1;
		}
		if (awaitingSource) {
			wchar_t nativePath[520]{};
			AcquireSRWLockShared(&g_safeLock);
			const bool published = g_safeSourcePublishedId == sourceId;
			if (published) wcscpy_s(nativePath, g_safeSourcePath);
			ReleaseSRWLockShared(&g_safeLock);
			if (published) {
				awaitingSource = false;
				if (nativePath[0] && generation == g_safeGeneration.load(std::memory_order_acquire)
					&& OpenAudioReader(nativePath, &reader, &format)) {
					if (waveOutOpen(&output, WAVE_MAPPER, &format, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) {
						output = nullptr; reader->Release(); reader = nullptr;
					} else waveOutPause(output);
                    if (!output) g_safeMediaState = -1;
				} else g_safeMediaState = -1;
			}
		}
		if (!reader || !output) { WaitForSingleObject(g_safeWake.load(), 100); continue; }
		int occupied = 0, freeIndex = -1;
		for (int i = 0; i < kAudioBlockCount; ++i) {
			AudioBlock& block = blocks[i];
			if (block.prepared && (block.header.dwFlags & WHDR_DONE)) {
				waveOutUnprepareHeader(output, &block.header, sizeof(WAVEHDR));
				block.prepared = false; block.header = {}; block.bytes.clear();
			}
			if (block.prepared) ++occupied;
			else if (freeIndex < 0) freeIndex = i;
		}
		if (first && !playing) {
			const unsigned request = g_safeRequest.exchange(0, std::memory_order_acq_rel);
			if (request == generation && generation == g_safeGeneration.load(std::memory_order_acquire)) {
				AudioBlock& block = blocks[0];
				ScalePcm16(block.bytes, g_safeVolume.load(std::memory_order_relaxed));
				block.header.lpData = (LPSTR)block.bytes.data();
				block.header.dwBufferLength = (DWORD)block.bytes.size();
				if (waveOutPrepareHeader(output, &block.header, sizeof(WAVEHDR)) == MMSYSERR_NOERROR) {
					block.prepared = true;
					if (waveOutWrite(output, &block.header, sizeof(WAVEHDR)) == MMSYSERR_NOERROR
						&& waveOutRestart(output) == MMSYSERR_NOERROR) { playing = true;g_safeMediaState = 2;++g_safeStartedCount; }
				}
				if (!playing) {
                    ReleaseAudioBlocks(output,blocks);waveOutClose(output);output=nullptr;reader->Release();reader=nullptr;
                    first=false;g_safeReady=0;g_safeClaimed=0;g_safeMediaState=-1;
                }
				continue;
			}
			WaitForSingleObject(g_safeWake.load(), 100);
			continue;
		}
		if (eof) {
			if (!occupied) {
				g_safeClaimed.store(0, std::memory_order_release);g_safeMediaState = 0;
				ReleaseAudioBlocks(output, blocks); waveOutClose(output); output = nullptr;
				reader->Release(); reader = nullptr;
				first = playing = eof = attempted = false;
			} else WaitForSingleObject(g_safeWake.load(), 10);
			continue;
		}
		if (freeIndex < 0) { WaitForSingleObject(g_safeWake.load(), 10); continue; }
		DWORD stream = 0, flags = 0;
		LONGLONG timestamp = 0;
		IMFSample* sample = nullptr;
		HRESULT hr = reader->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0,
			&stream, &flags, &timestamp, &sample);
		bool valid=SUCCEEDED(hr);
		if (sample) {
			IMFMediaBuffer* buffer = nullptr;
			BYTE* bytes = nullptr; DWORD maximum = 0, length = 0;
			bool locked = false;
			if (SUCCEEDED(sample->ConvertToContiguousBuffer(&buffer)) && buffer
				&& SUCCEEDED(buffer->Lock(&bytes, &maximum, &length))) {
				locked = true;
				if (bytes && length && length <= kAudioSampleMax && length % format.nBlockAlign == 0) {
					AudioBlock& block = blocks[freeIndex];
					bool copied = false;
					try { block.bytes.assign(bytes, bytes + length); copied = true; }
					catch (...) { valid=false; }
					if (copied && !playing) {
						first = true;
						if (generation == g_safeGeneration.load(std::memory_order_acquire)
							&& g_safeEnabled.load()) {g_safeReady.store(generation, std::memory_order_release);g_safeMediaState = 1;}
					} else if (copied && generation == g_safeGeneration.load(std::memory_order_acquire) && g_safeEnabled.load() && !g_safeStop.load()) {
						ScalePcm16(block.bytes, g_safeVolume.load(std::memory_order_relaxed));
						block.header.lpData = (LPSTR)block.bytes.data(); block.header.dwBufferLength = length;
						if (waveOutPrepareHeader(output, &block.header, sizeof(WAVEHDR)) == MMSYSERR_NOERROR) {
							block.prepared = true;
							if (waveOutWrite(output, &block.header, sizeof(WAVEHDR)) != MMSYSERR_NOERROR)valid=false;
						} else valid=false;
					}
				} else valid=false;
			} else valid=false;
			if (locked) buffer->Unlock();
			if (buffer) buffer->Release();
			sample->Release();
		}
		if (flags & MF_SOURCE_READERF_ENDOFSTREAM) eof = true;
		if (!sample && !eof && valid) WaitForSingleObject(g_safeWake.load(), 10);
		if (!valid || (eof && !playing && !first)) {
			ReleaseAudioBlocks(output, blocks); waveOutClose(output); output = nullptr;
			reader->Release(); reader = nullptr;
            first=playing=false;g_safeReady=0;g_safeClaimed=0;
            if(generation==g_safeGeneration.load()&&g_safeEnabled.load())g_safeMediaState=-1;
		}
	}
	g_safeReady.store(0, std::memory_order_release);
	if (output) { ReleaseAudioBlocks(output, blocks); waveOutClose(output); }
	if (reader) reader->Release();
	if (SUCCEEDED(mf)) MFShutdown();
	if (SUCCEEDED(com)) CoUninitialize();
	return 0;
}
} // namespace

void SkeetoSafeMusicCancel() {
    g_safeMediaState = 0;
	g_safeGeneration.fetch_add(1, std::memory_order_acq_rel);
	g_safeReady.store(0, std::memory_order_release);
	g_safeRequest.store(0, std::memory_order_release);
	g_safeClaimed.store(0, std::memory_order_release);
	SafeMusicWake();
}

void SkeetoSafeMusicConfigure(const char* directory, bool enabled, int volume, bool random, const char* selected) {
	SafeMusicConfig config{};
	wchar_t wideDirectory[520]{};
	char utf8Directory[520]{};
	if (directory && directory[0]
		&& MultiByteToWideChar(CP_ACP, 0, directory, -1, wideDirectory, (int)_countof(wideDirectory))
		&& WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wideDirectory, -1,
			utf8Directory, (int)sizeof(utf8Directory), nullptr, nullptr)
		&& strlen(utf8Directory) + sizeof("\\sound\\skeeto\\safe") <= sizeof(config.directory))
		sprintf_s(config.directory, "%s\\sound\\skeeto\\safe", utf8Directory);
	if (selected) strncpy_s(config.selected, selected, _TRUNCATE);
	config.enabled = enabled; config.random = random;
	AcquireSRWLockExclusive(&g_safeLock);
	const bool scan = enabled && (!g_safeConfig.enabled || strcmp(config.directory, g_safeConfig.directory));
	const bool changed = config.enabled != g_safeConfig.enabled || config.random != g_safeConfig.random
		|| strcmp(config.directory, g_safeConfig.directory) || strcmp(config.selected, g_safeConfig.selected);
	if (changed) g_safeConfig = config;
	ReleaseSRWLockExclusive(&g_safeLock);
	const int boundedVolume = volume < 0 ? 0 : volume > 100 ? 100 : volume;
	if (boundedVolume != g_safeVolume.load(std::memory_order_relaxed))
		g_safeVolume.store(boundedVolume, std::memory_order_relaxed);
	if (changed) g_safeEnabled.store(enabled, std::memory_order_release);
	if (scan) {
		g_safeCatalogReady.store(false, std::memory_order_release);
		g_safeScan.store(true, std::memory_order_release);
	}
	if (changed) SkeetoSafeMusicCancel();
}

void SkeetoSafeMusicResourcePump(bool allowEngineAccess) {
	// Paint owns all Source handles. MainThread can only abandon them on shutdown.
	AcquireSRWLockExclusive(&g_safeResourceLock);
	const unsigned generation = g_safeGeneration.load(std::memory_order_acquire);
	const bool enabled = g_safeEnabled.load(std::memory_order_acquire);
	if (generation != g_safeResourceGeneration || !enabled) {
		if (g_safeScanPhase >= 0 && enabled) g_safeScan.store(true, std::memory_order_release);
		DlcGameGlobScanCancel(g_safeGlob); g_safeGlob = nullptr;
		DlcCacheExtractCancel(g_safeExtract); g_safeExtract = nullptr;
		g_safeScanPhase = -1;
		g_safeExtractId = g_safeExtractDoneId = 0;
		g_safeResourceGeneration = generation;
	}
	if (!enabled) {
		g_safeScan.store(false, std::memory_order_release);
		g_safeCatalogReady.store(false, std::memory_order_release);
		ReleaseSRWLockExclusive(&g_safeResourceLock);
		return;
	}
	if (!allowEngineAccess) { ReleaseSRWLockExclusive(&g_safeResourceLock); return; }
	if (g_safeScan.exchange(false, std::memory_order_acq_rel)) {
		DlcGameGlobScanCancel(g_safeGlob); g_safeGlob = nullptr;
		g_safeScanCatalog = {};
		g_safeScanPhase = 0;
		g_safeCatalogReady.store(false, std::memory_order_release);
	}
	if (g_safeScanPhase >= 0) {
		const char* glob = g_safeScanPhase == 0 ? "sound/skeeto/safe/*.wav" : "sound/skeeto/safe/*.mp3";
		if (!g_safeGlob) g_safeGlob = DlcGameGlobScanBegin(glob);
		const int result = g_safeGlob
			? DlcGameGlobScanPump(g_safeGlob, 16, SafeMusicCatalogAddName, &g_safeScanCatalog) : -1;
		if (result != 0 || g_safeScanCatalog.truncated) {
			if (result < 0) g_safeScanCatalog.failed = true;
			if (result == 2) g_safeScanCatalog.truncated = true;
			DlcGameGlobScanCancel(g_safeGlob); g_safeGlob = nullptr;
			if (++g_safeScanPhase >= 2 || g_safeScanCatalog.truncated) {
				g_safeScanPhase = -1;
				if (generation == g_safeGeneration.load(std::memory_order_acquire)) SafeMusicPublishCatalog();
				else g_safeScan.store(true, std::memory_order_release);
			}
		}
		ReleaseSRWLockExclusive(&g_safeResourceLock);
		return;
	}
	char name[256]{};
	unsigned id = 0, sourceGeneration = 0;
	AcquireSRWLockShared(&g_safeLock);
	id = g_safeSourceId; sourceGeneration = g_safeSourceGeneration;
	if (id && sourceGeneration == generation) strcpy_s(name, g_safeSourceName);
	ReleaseSRWLockShared(&g_safeLock);
	if (id && id != g_safeExtractDoneId && sourceGeneration == generation) {
		if (id != g_safeExtractId) {
			DlcCacheExtractCancel(g_safeExtract); g_safeExtract = nullptr;
			g_safeExtractId = id;
			char relative[260]{};
			const char* extension = strrchr(name, '.');
			if (name[0] && !strpbrk(name, "/\\:\r\n") && extension
				&& (!_stricmp(extension, ".wav") || !_stricmp(extension, ".mp3")))
				g_safeExtract = (sprintf_s(relative, "sound/skeeto/safe/%s", name) > 0)
					? DlcCacheExtractBegin(relative, !_stricmp(extension, ".wav") ? L".wav" : L".mp3",
						128u * 1024u * 1024u) : nullptr;
		}
		wchar_t nativePath[520]{};
		const int result = g_safeExtract ? DlcCacheExtractPump(g_safeExtract, 256u * 1024u,
			nativePath, _countof(nativePath)) : -1;
		if (result != 0) {
			DlcCacheExtractCancel(g_safeExtract); g_safeExtract = nullptr;
			g_safeExtractDoneId = id;
			AcquireSRWLockExclusive(&g_safeLock);
			if (generation == g_safeGeneration.load(std::memory_order_acquire)
				&& id == g_safeSourceId && generation == g_safeSourceGeneration) {
				if (result > 0) wcscpy_s(g_safeSourcePath, nativePath);
				else g_safeSourcePath[0] = 0;
				g_safeSourcePublishedId = id;
			}
			ReleaseSRWLockExclusive(&g_safeLock);
			SafeMusicWake();
		}
	}
	ReleaseSRWLockExclusive(&g_safeResourceLock);
}

void SkeetoSafeMusicReload() {
	if (!g_safeEnabled.load(std::memory_order_acquire)) return;
	g_safeCatalogReady.store(false, std::memory_order_release);
	g_safeScan.store(true, std::memory_order_release);
	SkeetoSafeMusicCancel();
}

bool SkeetoSafeMusicGetCatalog(SkeetoSafeMusicCatalog* out) {
	if (!out) return false;
	AcquireSRWLockShared(&g_safeLock);
	const bool changed = out->revision != g_safeCatalog.revision;
	if (changed) *out = g_safeCatalog;
	ReleaseSRWLockShared(&g_safeLock);
	return changed;
}

bool SkeetoSafeMusicQueuePlay() {
	if (!g_safeEnabled.load(std::memory_order_acquire) || g_safeStop.load(std::memory_order_acquire)) return false;
	const unsigned generation = g_safeGeneration.load(std::memory_order_acquire);
	if (g_safeClaimed.load(std::memory_order_acquire) == generation) return true;
	unsigned ready = g_safeReady.load(std::memory_order_acquire);
	if (!ready || ready != g_safeGeneration.load(std::memory_order_acquire)) return false;
	if (!g_safeReady.compare_exchange_strong(ready, 0, std::memory_order_acq_rel)) return false;
	g_safeClaimed.store(ready, std::memory_order_release);
	g_safeRequest.store(ready, std::memory_order_release);
	SafeMusicWake();
	return ready == g_safeGeneration.load(std::memory_order_acquire) && g_safeEnabled.load(std::memory_order_acquire);
}

static void SafeMusicStopWorker(bool abandonResources) {
	g_safeStop.store(true, std::memory_order_release);
	SkeetoSafeMusicCancel();
	if (g_safeWorker) {
		WaitForSingleObject(g_safeWorker, INFINITE);
		CloseHandle(g_safeWorker); g_safeWorker = nullptr;
	}
	if (abandonResources) {
		AcquireSRWLockExclusive(&g_safeResourceLock);
		DlcGameGlobScanAbandon(g_safeGlob); g_safeGlob = nullptr;
		DlcCacheExtractAbandon(g_safeExtract); g_safeExtract = nullptr;
		g_safeScanPhase = -1;
		g_safeResourceGeneration = 0;
		g_safeCatalogReady.store(false, std::memory_order_release);
		ReleaseSRWLockExclusive(&g_safeResourceLock);
	}
	HANDLE wake = g_safeWake.exchange(nullptr, std::memory_order_acq_rel);
	while (g_safeWakeUsers.load(std::memory_order_acquire)) Sleep(1);
	if (wake) CloseHandle(wake);
}

void SkeetoSafeMusicShutdown() { SafeMusicStopWorker(true); }

void SkeetoSafeMusicLifecyclePump() {
	if (!g_safeEnabled.load(std::memory_order_acquire)) {
		if (g_safeWorker || g_safeWake.load()) SafeMusicStopWorker(false);
		return;
	}
	if (g_safeWorker) return;
	g_safeStop.store(false, std::memory_order_release);
	HANDLE wake = CreateEventW(nullptr, FALSE, FALSE, nullptr);
	if (!wake) return;
	g_safeWake.store(wake, std::memory_order_release);
	g_safeWorker = CreateThread(nullptr, 0, SafeMusicThread, nullptr, 0, nullptr);
	if (!g_safeWorker) {
		wake = g_safeWake.exchange(nullptr, std::memory_order_acq_rel);
		while (g_safeWakeUsers.load(std::memory_order_acquire)) Sleep(1);
		CloseHandle(wake);
	}
}


namespace {
static constexpr const char* kLastMusicPath = "sound/skeeto/the last man/Rainie_Love.mp3";
static SRWLOCK g_lastMusicLock = SRWLOCK_INIT;
static std::atomic_bool g_lastMusicEnabled{false}, g_lastMusicActive{false}, g_lastMusicStop{false};
static std::atomic_int g_lastMusicVolume{100}, g_lastMusicState{0};
static std::atomic_uint g_lastMusicGeneration{1};
static std::atomic_uint g_lastMusicFinished{0};
static std::atomic_uint g_lastMusicStarted{0};
static wchar_t g_lastMusicPath[520]{};
static HANDLE g_lastMusicWorker = nullptr, g_lastMusicWake = nullptr;
// Extraction is Paint-owned; teardown may abandon it after Paint has stopped.
static DlcCacheExtract* g_lastMusicExtract = nullptr;
static bool g_lastMusicScanAttempted = false;
static std::atomic_bool g_lastMusicReload{true};

static void LastMusicWake() {
 AcquireSRWLockShared(&g_lastMusicLock);
 if (g_lastMusicWake) SetEvent(g_lastMusicWake);
 ReleaseSRWLockShared(&g_lastMusicLock);
}
static DWORD WINAPI LastMusicThread(void*) {
 const HRESULT com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
 const HRESULT mf = SUCCEEDED(com) ? MFStartup(MF_VERSION, MFSTARTUP_LITE) : E_FAIL;
 IMFSourceReader* reader = nullptr; HWAVEOUT output = nullptr;
 WAVEFORMATEX format{}; AudioBlock blocks[kAudioBlockCount]{};
 unsigned generation = 0; bool attempted = false, eof = false, started = false;
 while (!g_lastMusicStop.load(std::memory_order_acquire)) {
  const unsigned current = g_lastMusicGeneration.load(std::memory_order_acquire);
  const bool active = g_lastMusicEnabled.load(std::memory_order_acquire) && g_lastMusicActive.load(std::memory_order_acquire);
  if (generation != current || !active) {
   if (output) { ReleaseAudioBlocks(output, blocks); waveOutClose(output); output = nullptr; }
   if (reader) { reader->Release(); reader = nullptr; }
   generation = current; attempted = false; eof = false; started = false;
  }
  if (!active || FAILED(mf)) {
   if (active && FAILED(mf)) g_lastMusicState.store(-1, std::memory_order_release);
   WaitForSingleObject(g_lastMusicWake, 100); continue;
  }
  if (!reader && !attempted && g_lastMusicState.load(std::memory_order_acquire) == 1) {
   wchar_t path[520]{}; AcquireSRWLockShared(&g_lastMusicLock); wcscpy_s(path, g_lastMusicPath); ReleaseSRWLockShared(&g_lastMusicLock);
   attempted = true;
   if (!OpenAudioReader(path, &reader, &format) || waveOutOpen(&output, WAVE_MAPPER, &format, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) {
    if (reader) { reader->Release(); reader = nullptr; } output = nullptr;
    if (generation == g_lastMusicGeneration.load(std::memory_order_acquire)) g_lastMusicState.store(-1, std::memory_order_release);
   }
  }
  if (!reader || !output) { WaitForSingleObject(g_lastMusicWake, 100); continue; }
  int freeIndex = -1, occupied = 0;
  for (int i = 0; i < kAudioBlockCount; ++i) {
   auto& b = blocks[i];
   if (b.prepared && (b.header.dwFlags & WHDR_DONE)) { waveOutUnprepareHeader(output, &b.header, sizeof(WAVEHDR)); b.prepared = false; b.header = {}; b.bytes.clear(); }
   if (!b.prepared && freeIndex < 0) freeIndex = i;
   if (b.prepared) ++occupied;
  }
  if (eof) {
   if (!occupied) {
    ReleaseAudioBlocks(output, blocks); waveOutClose(output); output = nullptr;
    reader->Release(); reader = nullptr; eof = false;
    g_lastMusicFinished.store(generation, std::memory_order_release);
   } else WaitForSingleObject(g_lastMusicWake, 10);
   continue;
  }
  if (freeIndex < 0) { WaitForSingleObject(g_lastMusicWake, 10); continue; }
  DWORD stream = 0, flags = 0; LONGLONG timestamp = 0; IMFSample* sample = nullptr;
  const HRESULT hr = reader->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, &stream, &flags, &timestamp, &sample);
  bool ok = SUCCEEDED(hr);
  if (sample) {
   IMFMediaBuffer* buffer = nullptr; BYTE* bytes = nullptr; DWORD maximum = 0, length = 0;
   if (SUCCEEDED(sample->ConvertToContiguousBuffer(&buffer)) && buffer && SUCCEEDED(buffer->Lock(&bytes, &maximum, &length))) {
    if (bytes && length && length <= kAudioSampleMax && length % format.nBlockAlign == 0) {
     auto& b = blocks[freeIndex];
     try { b.bytes.assign(bytes, bytes + length); } catch (...) { ok = false; }
     if (ok) {
     ScalePcm16(b.bytes, g_lastMusicVolume.load(std::memory_order_relaxed));
     b.header = {}; b.header.lpData = (LPSTR)b.bytes.data(); b.header.dwBufferLength = length;
     // Recheck bounded intent after a potentially blocking MF read.
     if (generation == g_lastMusicGeneration.load(std::memory_order_acquire) && g_lastMusicActive.load(std::memory_order_acquire)
      && g_lastMusicEnabled.load(std::memory_order_acquire) && !g_lastMusicStop.load(std::memory_order_acquire)) {
      if (waveOutPrepareHeader(output, &b.header, sizeof(WAVEHDR)) == MMSYSERR_NOERROR) {
       b.prepared = true; ok = waveOutWrite(output, &b.header, sizeof(WAVEHDR)) == MMSYSERR_NOERROR;
       if (ok && !started) { started = true;++g_lastStartedCount; g_lastMusicStarted.store(generation, std::memory_order_release); }
      } else ok = false;
     }
     }
    } else ok = false;
    buffer->Unlock();
   } else ok = false;
   if (buffer) buffer->Release(); sample->Release();
  }
  if (flags & MF_SOURCE_READERF_ENDOFSTREAM) eof = true;
  if (!sample && !(flags & MF_SOURCE_READERF_ENDOFSTREAM) && ok) WaitForSingleObject(g_lastMusicWake, 10);
  if (!ok) {
   ReleaseAudioBlocks(output, blocks); waveOutClose(output); output = nullptr; reader->Release(); reader = nullptr;
   if (generation == g_lastMusicGeneration.load(std::memory_order_acquire)) g_lastMusicState.store(-1, std::memory_order_release);
  }
 }
 if (output) { ReleaseAudioBlocks(output, blocks); waveOutClose(output); }
 if (reader) reader->Release(); if (SUCCEEDED(mf)) MFShutdown(); if (SUCCEEDED(com)) CoUninitialize();
 return 0;
}
static void LastMusicStopWorker() {
 g_lastMusicStop.store(true, std::memory_order_release); LastMusicWake();
 if (g_lastMusicWorker) { WaitForSingleObject(g_lastMusicWorker, INFINITE); CloseHandle(g_lastMusicWorker); g_lastMusicWorker = nullptr; }
 AcquireSRWLockExclusive(&g_lastMusicLock);
 if (g_lastMusicWake) { CloseHandle(g_lastMusicWake); g_lastMusicWake = nullptr; }
 ReleaseSRWLockExclusive(&g_lastMusicLock);
}
}

void SkeetoLastMusicConfigure(bool enabled, int volumePercent) {
 if (volumePercent < 0) volumePercent = 0; if (volumePercent > 100) volumePercent = 100;
 g_lastMusicVolume.store(volumePercent, std::memory_order_relaxed);
 if (g_lastMusicEnabled.exchange(enabled, std::memory_order_acq_rel) == enabled) return;
 SkeetoLastMusicSetActive(false); SkeetoLastMusicReload();
}
void SkeetoLastMusicSetActive(bool active) {
 active = active && g_lastMusicEnabled.load(std::memory_order_acquire);
 if (g_lastMusicActive.exchange(active, std::memory_order_acq_rel) == active
  && (!active || g_lastMusicFinished.load(std::memory_order_acquire) != g_lastMusicGeneration.load(std::memory_order_acquire))) return;
 g_lastMusicGeneration.fetch_add(1, std::memory_order_acq_rel); LastMusicWake();
}
void SkeetoLastMusicReload() {
 g_lastMusicReload.store(true, std::memory_order_release); g_lastMusicState.store(0, std::memory_order_release);
 g_lastMusicGeneration.fetch_add(1, std::memory_order_acq_rel);
 LastMusicWake();
}
void SkeetoLastMusicResourcePump(bool allowEngineAccess) {
 if (g_lastMusicReload.exchange(false, std::memory_order_acq_rel)) {
  DlcCacheExtractCancel(g_lastMusicExtract); g_lastMusicExtract = nullptr; g_lastMusicScanAttempted = false;
  AcquireSRWLockExclusive(&g_lastMusicLock); g_lastMusicPath[0] = 0; ReleaseSRWLockExclusive(&g_lastMusicLock);
 }
 if (!g_lastMusicEnabled.load(std::memory_order_acquire) || !allowEngineAccess) return;
 if (!g_lastMusicScanAttempted) { g_lastMusicScanAttempted = true; g_lastMusicExtract = DlcCacheExtractBegin(kLastMusicPath, L".mp3", 128u * 1024u * 1024u); }
 if (!g_lastMusicExtract) { if (!g_lastMusicState.load(std::memory_order_acquire)) g_lastMusicState.store(-1, std::memory_order_release); return; }
 wchar_t path[520]{};
 const int result = DlcCacheExtractPump(g_lastMusicExtract, 256u * 1024u, path, _countof(path));
 if (!result) return;
 DlcCacheExtractCancel(g_lastMusicExtract); g_lastMusicExtract = nullptr;
 AcquireSRWLockExclusive(&g_lastMusicLock); if (result > 0) wcscpy_s(g_lastMusicPath, path); ReleaseSRWLockExclusive(&g_lastMusicLock);
 g_lastMusicState.store(result > 0 ? 1 : -1, std::memory_order_release); LastMusicWake();
}
int SkeetoLastMusicState() { return g_lastMusicState.load(std::memory_order_acquire); }
unsigned SkeetoLastMusicStartedGeneration() {
 const unsigned started = g_lastMusicStarted.load(std::memory_order_acquire);
 return g_lastMusicEnabled.load(std::memory_order_acquire) && g_lastMusicActive.load(std::memory_order_acquire)
  && started == g_lastMusicGeneration.load(std::memory_order_acquire) ? started : 0;
}
void SkeetoLastMusicLifecyclePump() {
 if (!g_lastMusicEnabled.load(std::memory_order_acquire)) { if (g_lastMusicWorker) LastMusicStopWorker(); return; }
 if (g_lastMusicWorker) return;
 g_lastMusicStop.store(false, std::memory_order_release);
 AcquireSRWLockExclusive(&g_lastMusicLock); g_lastMusicWake = CreateEventW(nullptr, FALSE, FALSE, nullptr); ReleaseSRWLockExclusive(&g_lastMusicLock);
 if (!g_lastMusicWake) return;
 g_lastMusicWorker = CreateThread(nullptr, 0, LastMusicThread, nullptr, 0, nullptr);
 if (!g_lastMusicWorker) { LastMusicStopWorker(); g_lastMusicState.store(-1, std::memory_order_release); }
}
void SkeetoLastMusicShutdown() {
 g_lastMusicEnabled.store(false, std::memory_order_release); g_lastMusicActive.store(false, std::memory_order_release); LastMusicStopWorker();
 DlcCacheExtractAbandon(g_lastMusicExtract); g_lastMusicExtract = nullptr;
}

void SkeetoMusicPruneCache() {
    wchar_t safe[520]{},last[520]{};
    AcquireSRWLockShared(&g_safeLock);if(g_safeEnabled.load())wcscpy_s(safe,g_safeSourcePath);ReleaseSRWLockShared(&g_safeLock);
    AcquireSRWLockShared(&g_lastMusicLock);if(g_lastMusicEnabled.load())wcscpy_s(last,g_lastMusicPath);ReleaseSRWLockShared(&g_lastMusicLock);
    musicPruneFiles(safe,last);
}

SkeetoMusicStatus SkeetoMusicGetStatus() {
    const auto generation=g_lastMusicGeneration.load();
    const bool playing=g_lastMusicEnabled.load()&&g_lastMusicActive.load()&&g_lastMusicState.load()>0&&g_lastMusicStarted.load()==generation&&g_lastMusicFinished.load()!=generation;
    return {g_safeEnabled.load()?g_safeMediaState.load():0,g_lastMusicEnabled.load()?(playing?2:g_lastMusicState.load()):0,g_safeStartedCount.load(),g_lastStartedCount.load()};
}
