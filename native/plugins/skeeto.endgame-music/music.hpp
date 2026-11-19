#pragma once
#include <windows.h>
#include "l4p_file.h"
struct SkeetoSafeMusicCatalog {
	unsigned revision;
	int count;
	bool truncated, failed;
	char names[128][256];
};

// Configure/catalog access run on Paint. Lifecycle/Shutdown run on MainThread.
// QueuePlay/Cancel publish bounded requests and never call Source interfaces.
void SkeetoSafeMusicConfigure(const char* gameLeft4Dead2Dir, bool enabled,
	int volumePercent, bool random, const char* selectedUtf8);
void SkeetoSafeMusicLifecyclePump();
// Paint only: GAME/VPK enumeration (16 entries) and selected-file extraction
// (256 KiB) per call. Disable engine work while loading; cancellation still drains.
void SkeetoSafeMusicResourcePump(bool allowEngineAccess = true);
void SkeetoSafeMusicReload();
bool SkeetoSafeMusicGetCatalog(SkeetoSafeMusicCatalog* out);
bool SkeetoSafeMusicQueuePlay();
void SkeetoSafeMusicCancel();
void SkeetoSafeMusicShutdown();

// Fixed Last Man track. Source extraction on Paint; MF/waveOut on its worker.
void SkeetoLastMusicConfigure(bool enabled, int volumePercent);
void SkeetoLastMusicSetActive(bool active);
void SkeetoLastMusicResourcePump(bool allowEngineAccess);
void SkeetoLastMusicReload();
int SkeetoLastMusicState(); // 0 preparing, 1 ready, -1 unavailable
unsigned SkeetoLastMusicStartedGeneration(); // Current request's first submitted PCM, or 0.
void SkeetoLastMusicLifecyclePump(); // MainThread, never Paint
void SkeetoLastMusicShutdown();

void SkeetoMusicBind(const L4P_FileApiV1&,const uint32_t*,const wchar_t* cacheDirectory);
void SkeetoMusicPruneCache();
void SkeetoMusicClearCache();

struct SkeetoMusicStatus {int safe,last;unsigned safeStarts,lastStarts;};
SkeetoMusicStatus SkeetoMusicGetStatus();
